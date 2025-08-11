import { prisma } from "./lib/prisma.js";

export const handler = async (event, context) => {
  console.log("Portfolio updater Lambda started");

  try {
    // Test database connection
    await prisma.$connect();
    console.log("Database connected successfully");

    // Get all users
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} users to process`);

    if (users.length === 0) {
      console.log("No users found, exiting");
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No users found" }),
      };
    }

    // Get all tokens for price data
    const tokens = await prisma.token.findMany();
    console.log(`Found ${tokens.length} tokens`);

    if (tokens.length === 0) {
      console.log("No tokens found, exiting");
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No tokens found" }),
      };
    }

    // Filter out USDC token (assuming it's in environment variables)
    const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS;
    const filteredTokens = tokens.filter(
      (token) =>
        !usdcAddress ||
        token.address.toLowerCase() !== usdcAddress.toLowerCase()
    );
    console.log(`Filtered tokens (excluding USDC): ${filteredTokens.length}`);

    // Create a map for quick token lookup
    const tokenMap = new Map();
    filteredTokens.forEach((token) => {
      tokenMap.set(token.address, {
        ...token,
        price: token.price ? parseFloat(token.price.toString()) : 0,
        decimals: parseFloat(token.decimals.toString()),
      });
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day

    let processedUsers = 0;
    let updatedPortfolios = 0;
    let errors = 0;

    // Process each user
    for (const user of users) {
      try {
        console.log(
          `\n--- Processing user: ${user.wallet} (FID: ${user.fid}) ---`
        );

        // Get user's active plans
        const userPlans = await prisma.dCAPlan.findMany({
          where: {
            userWallet: user.wallet,
            active: true,
          },
          include: {
            tokenOut: true,
            executions: true,
          },
        });

        console.log(`User has ${userPlans.length} active plans`);

        // Calculate portfolio metrics
        let portfolioCurrentValue = 0;
        let portfolioInvestedAmount = 0;

        // Process each plan and its executions
        for (const plan of userPlans) {
          const token = tokenMap.get(plan.tokenOut.address);
          if (!token) {
            console.log(`Token not found for plan: ${plan.tokenOut.address}`);
            continue;
          }

          const executions = plan.executions;
          if (executions.length === 0) {
            continue;
          }

          // Calculate total invested value (sum of all amountIn minus fees in USDC)
          const totalInvestedValue = executions.reduce((sum, execution) => {
            const amountIn = Number(execution.amountIn) / 1_000_000; // Convert from USDC decimals (6)
            const feeAmount = Number(execution.feeAmount) / 1_000_000; // Convert from USDC decimals (6)
            return sum + (amountIn - feeAmount); // Subtract fees from investment amount
          }, 0);

          // Calculate current value (sum of all tokenOutAmount * current price)
          const totalTokenAmount = executions.reduce((sum, execution) => {
            return (
              sum + Number(execution.amountOut) / Math.pow(10, token.decimals)
            );
          }, 0);

          const currentValue = totalTokenAmount * token.price;

          portfolioInvestedAmount += totalInvestedValue;
          portfolioCurrentValue += currentValue;
        }

        // Calculate percent change
        const percentChange =
          portfolioInvestedAmount > 0
            ? ((portfolioCurrentValue - portfolioInvestedAmount) /
                portfolioInvestedAmount) *
              100
            : 0;

        console.log(`Portfolio calculation for ${user.wallet}:`, {
          portfolioCurrentValue,
          portfolioInvestedAmount,
          percentChange,
        });

        // Upsert the portfolio daily change record
        const portfolioRecord = await prisma.portfolioDailyChange.upsert({
          where: {
            userWallet_date: {
              userWallet: user.wallet,
              date: today,
            },
          },
          update: {
            totalInvestedValue: portfolioInvestedAmount,
            currentValue: portfolioCurrentValue,
            percentChange: percentChange,
          },
          create: {
            userWallet: user.wallet,
            date: today,
            totalInvestedValue: portfolioInvestedAmount,
            currentValue: portfolioCurrentValue,
            percentChange: percentChange,
          },
        });

        console.log(
          `Updated portfolio record for ${user.wallet}:`,
          portfolioRecord.id
        );
        updatedPortfolios++;
        processedUsers++;
      } catch (userError) {
        console.error(`Error processing user ${user.wallet}:`, userError);
        errors++;
      }
    }

    console.log("\n=== Portfolio update completed ===");
    console.log("Summary:", {
      processedUsers,
      updatedPortfolios,
      errors,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Portfolio update completed successfully",
        processedUsers,
        updatedPortfolios,
        errors,
      }),
    };
  } catch (error) {
    console.error("Error in portfolio updater:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
    };
  }
};
