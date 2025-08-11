import { prisma } from "./lib/prisma.js";

async function testPortfolioUpdater() {
  try {
    console.log("Testing portfolio updater logic...");

    // Test database connection
    await prisma.$connect();
    console.log("Database connected successfully");

    // Get all users
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} users`);

    if (users.length === 0) {
      console.log("No users found");
      return;
    }

    // Get all tokens
    const tokens = await prisma.token.findMany();
    console.log(`Found ${tokens.length} tokens`);

    if (tokens.length === 0) {
      console.log("No tokens found");
      return;
    }

    // Create token map
    const tokenMap = new Map();
    tokens.forEach((token) => {
      tokenMap.set(token.address, {
        ...token,
        price: token.price ? parseFloat(token.price.toString()) : 0,
        decimals: parseFloat(token.decimals.toString()),
      });
    });

    let processedUsers = 0;
    let updatedPortfolios = 0;
    let errors = 0;

    // Process each user (like the actual Lambda function)
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

        for (const plan of userPlans) {
          const token = tokenMap.get(plan.tokenOut.address);
          if (!token) {
            console.log(`Token not found for plan: ${plan.tokenOut.address}`);
            continue;
          }

          console.log(
            `Processing plan for token: ${token.symbol} (${token.address})`
          );
          console.log(
            `Token price: $${token.price}, decimals: ${token.decimals}`
          );
          console.log(`Plan has ${plan.executions.length} executions`);

          const executions = plan.executions;
          if (executions.length === 0) {
            console.log("No executions for this plan");
            continue;
          }

          // Calculate total invested value
          const totalInvestedValue = executions.reduce((sum, execution) => {
            const amountIn = Number(execution.amountIn) / 1_000_000;
            const feeAmount = Number(execution.feeAmount) / 1_000_000;
            const netAmount = amountIn - feeAmount;
            console.log(
              `Execution: amountIn=${amountIn}, feeAmount=${feeAmount}, netAmount=${netAmount}`
            );
            return sum + netAmount;
          }, 0);

          // Calculate current value
          const totalTokenAmount = executions.reduce((sum, execution) => {
            const tokenAmount =
              Number(execution.amountOut) / Math.pow(10, token.decimals);
            console.log(
              `Execution: amountOut=${execution.amountOut}, tokenAmount=${tokenAmount}`
            );
            return sum + tokenAmount;
          }, 0);

          const currentValue = totalTokenAmount * token.price;

          console.log(`Token ${token.symbol} metrics:`, {
            totalInvestedValue,
            totalTokenAmount,
            currentValue,
            tokenPrice: token.price,
          });

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

        console.log(`Final portfolio calculation for ${user.wallet}:`, {
          portfolioCurrentValue,
          portfolioInvestedAmount,
          percentChange,
        });

        // Test upsert operation
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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

        console.log("Portfolio record created/updated:", portfolioRecord.id);
        updatedPortfolios++;
        processedUsers++;
      } catch (userError) {
        console.error(`Error processing user ${user.wallet}:`, userError);
        errors++;
      }
    }

    console.log("\n=== Test completed ===");
    console.log("Summary:", {
      processedUsers,
      updatedPortfolios,
      errors,
    });
  } catch (error) {
    console.error("Error in test:", error);
  }
}

// Run the test
testPortfolioUpdater();
