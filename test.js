import { PrismaClient } from "@prisma/client";
import { ethers } from "ethers";

const prisma = new PrismaClient();

// Contract setup
const DCA_EXECUTOR_ADDRESS = process.env.DCA_EXECUTOR_ADDRESS;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const DCAExecutorABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_planId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_amountIn",
        type: "uint256",
      },
      {
        internalType: "uint24",
        name: "_poolFee",
        type: "uint24",
      },
    ],
    name: "executeDCAPlan",
    outputs: [
      {
        internalType: "uint256",
        name: "amountOut",
        type: "uint256",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// ERC20 ABI for allowance checking
const ERC20ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "address",
        name: "spender",
        type: "address",
      },
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

// Contract instance
const contractInstance = new ethers.Contract(
  DCA_EXECUTOR_ADDRESS,
  DCAExecutorABI,
  signer
);

async function checkTokenAllowance(tokenAddress, ownerAddress) {
  try {
    // Create ERC20 contract instance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, provider);

    // Check allowance directly from the USDC contract
    // allowance(owner, spender) - check how much owner has approved for spender (DCA executor)
    const allowance = await tokenContract.allowance(
      ownerAddress,
      DCA_EXECUTOR_ADDRESS
    );

    console.log(
      `Token allowance for ${ownerAddress} on ${tokenAddress}: ${allowance.toString()}`
    );
    return allowance;
  } catch (error) {
    console.error(`Error checking token allowance:`, error);
    throw error;
  }
}

async function notifyUserForMoreApproval(planId, userId) {
  try {
    // TODO: Implement proper notification system
    console.log(
      `User ${userId} needs to approve more tokens for plan ${planId}`
    );
  } catch (error) {
    console.error(`Error notifying user ${userId} for plan ${planId}:`, error);
  }
}

async function executeDCAPlan(plan, currentTimestamp) {
  try {
    console.log("Executing DCA plan:", plan);
    console.log("Current timestamp:", currentTimestamp);
    // Execute the DCA plan
    const tx = await contractInstance.executeDCAPlan(
      plan.recipient, // _user
      BigInt(plan.planId.toString()), // _planId
      BigInt(plan.amountIn.toString()), // _amountIn
      BigInt(plan.tokenOut.feeTier.toString()) // _poolFee
    );

    // Wait for transaction to be mined
    const receipt = await tx.wait();

    // Get the amountOut from the transaction receipt logs
    // Parse the DCAPlanExecuted event to extract amountOut
    const eventTopic =
      "0x5bb85ced8e36830fbb0c473b21ff268ddd67f189a58d75e3c1053f5b13a2469d";
    let amountOut = "0";
    let feeAmount = "0";
    let amountIn = "0";

    if (receipt.logs && receipt.logs.length > 0) {
      console.log("Receipt logs:", receipt.logs);

      // Find the DCAPlanExecuted event log
      const dcaExecutedEvent = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === DCA_EXECUTOR_ADDRESS.toLowerCase() &&
          log.topics[0] === eventTopic
      );

      if (dcaExecutedEvent) {
        console.log("Found DCAPlanExecuted event log:", dcaExecutedEvent);

        const data = dcaExecutedEvent.data.replace(/^0x/, "");

        if (data.length >= 64 * 4) {
          const tokenOutHex = data.slice(0, 64);
          const amountInHex = data.slice(64, 128);
          const amountOutHex = data.slice(128, 192);
          const feeAmountHex = data.slice(192, 256);

          const tokenOut = "0x" + tokenOutHex.slice(24); // last 40 chars = 20 bytes address
          amountIn = BigInt("0x" + amountInHex).toString();
          amountOut = BigInt("0x" + amountOutHex).toString();
          feeAmount = BigInt("0x" + feeAmountHex).toString();

          console.log(`TokenOut: ${tokenOut}`);
          console.log(`AmountIn: ${amountIn}`);
          console.log(`AmountOut: ${amountOut}`);
          console.log(`FeeAmount: ${feeAmount}`);
        } else {
          console.log("Log data too short or malformed:", data);
        }
      }
    }

    if (amountOut === "0") {
      console.log("Warning: Could not extract amountOut from transaction logs");
    }

    // Update the plan
    await prisma.dCAPlan.update({
      where: { id: plan.id },
      data: {
        lastExecutedAt: currentTimestamp,
      },
    });

    // Calculate price at transaction time
    // amountIn is in 6 decimals, amountOut is in 18 decimals
    // We want the price of tokenOut in USD (how much USD to buy 1 tokenOut)
    // const priceAtTx =
    //   Number(amountOut) > 0
    //     ? Number(amountIn) / (Number(amountOut) / Math.pow(10, 4))
    //     : 0;

    const priceAtTx = 0;

    // Create execution record
    await prisma.dCAExecution.create({
      data: {
        planId: plan.id,
        amountIn: plan.amountIn,
        tokenOutId: plan.tokenOutId,
        amountOut: amountOut,
        feeAmount: feeAmount,
        priceAtTx: priceAtTx.toString(),
        txHash: tx.hash,
      },
    });

    console.log(`Executed DCA plan: ${plan.id}`);
    console.log(`Transaction hash: ${tx.hash}`);
  } catch (error) {
    console.error(`Transaction failed for plan ${plan.id}:`, error);

    // Check if error is due to insufficient allowance
    if (
      error.shortMessage?.includes("ERC20: transfer amount exceeds allowance")
    ) {
      console.log(
        `Insufficient allowance for plan ${plan.id} - user needs to approve more tokens`
      );
      await notifyUserForMoreApproval(plan.id, plan.userId);
    }

    throw error;
  }
}

async function checkAndExecutePlans() {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    console.log(`Current timestamp: ${currentTimestamp}`);

    try {
      // Get all active plans with token information
      const plans = await prisma.dCAPlan.findMany({
        where: {
          active: true,
        },
        include: {
          tokenIn: true,
          tokenOut: true,
        },
      });

      console.log(`Found ${plans.length} active plans`);

      for (const plan of plans) {
        try {
          console.log(`\n--- Processing Plan ${plan.id} ---`);
          console.log(`Plan ID: ${plan.planId}`);
          console.log(`Recipient: ${plan.recipient}`);
          console.log(`Amount In: ${plan.amountIn}`);
          console.log(`Frequency: ${plan.frequency} seconds`);
          console.log(`Last Executed At: ${plan.lastExecutedAt}`);
          console.log(
            `Token In: ${plan.tokenIn.symbol} (${plan.tokenIn.address})`
          );
          console.log(
            `Token Out: ${plan.tokenOut.symbol} (${plan.tokenOut.address})`
          );

          const timeSinceLastExecution = currentTimestamp - plan.lastExecutedAt;
          const frequencySeconds = Number(plan.frequency);

          console.log(
            `Time since last execution: ${timeSinceLastExecution} seconds`
          );
          console.log(`Frequency required: ${frequencySeconds} seconds`);
          console.log(
            `Should execute: ${timeSinceLastExecution >= frequencySeconds}`
          );

          // 1. Check if enough time has passed since last execution
          if (timeSinceLastExecution >= frequencySeconds) {
            console.log(`✅ Plan ${plan.id} is due for execution`);

            const amountIn = Number(plan.amountIn);
            console.log(`Amount to execute: ${amountIn}`);

            // 2. Check actual token allowance from blockchain
            try {
              console.log(`Checking allowance for ${plan.tokenIn.symbol}...`);
              const currentAllowance = await checkTokenAllowance(
                plan.tokenIn.address, // USDC token address
                plan.recipient // user's wallet address
              );

              console.log(`Current allowance: ${currentAllowance.toString()}`);
              console.log(`Required amount: ${amountIn}`);
              console.log(
                `Allowance sufficient: ${Number(currentAllowance) >= amountIn}`
              );

              // 3. Skip execution if amountIn is greater than current allowance
              if (amountIn > Number(currentAllowance)) {
                console.log(
                  `❌ Skipping plan ${
                    plan.id
                  } - insufficient allowance. Required: ${amountIn}, Available: ${currentAllowance.toString()}`
                );
                await notifyUserForMoreApproval(plan.id, plan.userId);
                continue;
              }

              // 4. Execute the plan if allowance is sufficient
              try {
                console.log(`🚀 Executing plan ${plan.id}...`);
                await executeDCAPlan(plan, currentTimestamp);
                console.log(`✅ Successfully executed plan ${plan.id}`);
              } catch (executionError) {
                console.error(
                  `❌ Failed to execute plan ${plan.id}:`,
                  executionError
                );
                // Continue with other plans even if one fails
                continue;
              }
            } catch (allowanceError) {
              console.error(
                `❌ Error checking allowance for plan ${plan.id}:`,
                allowanceError
              );
              // Skip this plan if we can't check allowance
              continue;
            }
          } else {
            console.log(
              `⏰ Plan ${plan.id} is not due yet. Time remaining: ${
                frequencySeconds - timeSinceLastExecution
              } seconds`
            );
          }
        } catch (planError) {
          console.error(`❌ Error processing plan ${plan.id}:`, planError);
          // Continue with other plans even if one fails
          continue;
        }
      }
    } catch (dbError) {
      console.error("❌ Error fetching plans from database:", dbError);
    }
  } catch (error) {
    console.error("❌ Error in checkAndExecutePlans:", error);
  }
}

// Main function
async function main() {
  try {
    console.log("Starting DCA plans execution...");
    await checkAndExecutePlans();
    console.log("DCA plans execution completed successfully");
  } catch (error) {
    console.error("Error executing DCA plans:", error);
    process.exit(1);
  } finally {
    // Close Prisma connection
    await prisma.$disconnect();
  }
}

// Run the main function
main();
