import { updateAllTokenPrices } from "./index.js";

async function testTokenUpdate() {
  try {
    console.log("🧪 Testing token price update functionality...");
    await updateAllTokenPrices();
    console.log("✅ Test completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
testTokenUpdate();
