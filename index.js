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

// Contract instance
const contractInstance = new ethers.Contract(
  DCA_EXECUTOR_ADDRESS,
  DCAExecutorABI,
  signer
);

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
  const currentApprovalAmount = Number(plan.approvalAmount);
  const amountIn = Number(plan.amountIn);

  try {
    // Execute the DCA plan
    const tx = await contractInstance.executeDCAPlan(
      plan.recipient, // _user
      BigInt(plan.planId.toString()), // _planId
      BigInt(plan.amountIn.toString()), // _amountIn
      BigInt(plan.feeTier.toString()) // _poolFee
    );

    // Wait for transaction to be mined
    await tx.wait();

    // Only update database if transaction was successful
    const newApprovalAmount = currentApprovalAmount - amountIn;
    await prisma.dCAPlan.update({
      where: { id: plan.id },
      data: {
        approvalAmount: newApprovalAmount,
        lastExecutedAt: currentTimestamp,
      },
    });

    console.log(`Executed DCA plan: ${plan.id}`);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log(`New approval amount: ${newApprovalAmount}`);
  } catch (error) {
    console.error(`Transaction failed for plan ${plan.id}:`, error);

    // Check if error is due to insufficient allowance
    if (
      error.shortMessage?.includes("ERC20: transfer amount exceeds allowance")
    ) {
      // Set approval amount to 0 since the allowance is insufficient
      await prisma.dCAPlan.update({
        where: { id: plan.id },
        data: {
          approvalAmount: 0,
        },
      });
      console.log(
        `Set approval amount to 0 for plan ${plan.id} due to insufficient allowance`
      );
    }

    throw error;
  }
}

async function checkAndExecutePlans() {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);

    try {
      // Get all active plans
      const plans = await prisma.dCAPlan.findMany({
        where: {
          active: true,
        },
      });

      for (const plan of plans) {
        try {
          const timeSinceLastExecution = currentTimestamp - plan.lastExecutedAt;
          const frequencySeconds = Number(plan.frequency);

          // 1. Check if enough time has passed since last execution
          if (timeSinceLastExecution >= frequencySeconds) {
            console.log(
              `Checking plan ${plan.id} (frequency: ${frequencySeconds} seconds)`
            );

            const currentApprovalAmount = Number(plan.approvalAmount);
            const amountIn = Number(plan.amountIn);

            // 2. Skip execution if amountIn is greater than approvalAmount
            if (amountIn > currentApprovalAmount) {
              console.log(
                `Skipping plan ${plan.id} - insufficient approval amount`
              );
              await notifyUserForMoreApproval(plan.id, plan.userId);
              continue;
            }

            try {
              // Execute the plan
              await executeDCAPlan(plan, currentTimestamp);
              console.log(`Successfully executed plan ${plan.id}`);
            } catch (executionError) {
              console.error(
                `Failed to execute plan ${plan.id}:`,
                executionError
              );
              // Continue with other plans even if one fails
              continue;
            }
          }
        } catch (planError) {
          console.error(`Error processing plan ${plan.id}:`, planError);
          // Continue with other plans even if one fails
          continue;
        }
      }
    } catch (dbError) {
      console.error("Error fetching plans from database:", dbError);
    }
  } catch (error) {
    console.error("Error in checkAndExecutePlans:", error);
  }
}

// Main function for AWS Lambda
export const handler = async function (event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    console.log("Starting DCA plans execution...");
    await checkAndExecutePlans();
    console.log("DCA plans execution completed successfully");
  } catch (error) {
    console.error("Error executing DCA plans:", error);
    throw error; // Re-throw the error to mark the Lambda execution as failed
  } finally {
    // Close Prisma connection
    await prisma.$disconnect();
  }
};
