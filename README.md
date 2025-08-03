# DCA Cron Lambda

A serverless function for executing Dollar Cost Averaging (DCA) plans on the Base network.

## Features

### DCA Plan Execution
- Automatically executes DCA plans based on their frequency
- Supports both regular token swaps and native (WETH) swaps
- Integrates with 1inch API for optimal swap routing
- Handles token allowance checks and user notifications

### Token Price Updates
- **NEW**: Automatic token price updates from GeckoTerminal API
- Updates all tokens in the database with latest price data
- Fetches the following data for each token:
  - Current price (USD)
  - Fully Diluted Valuation (FDV)
  - Market capitalization
  - 24-hour trading volume
  - Circulating supply

## API Integration

### GeckoTerminal API
The function now calls the GeckoTerminal API to fetch real-time token data:
```
GET https://api.geckoterminal.com/api/v2/networks/base/tokens/{token_address}
```

**Response fields mapped to database:**
- `price_usd` → `price`
- `fdv_usd` → `fdv`
- `market_cap_usd` → `marketcap`
- `volume_usd.h24` → `volume24h`
- `total_supply` → `circulatingSupply`

## Execution Flow

When the Lambda function is triggered:

1. **Token Price Update**: Fetches latest price data for all tokens from GeckoTerminal
2. **DCA Plan Execution**: Checks and executes eligible DCA plans

## Testing

To test the token price update functionality:

```bash
node test-token-update.js
```

## Environment Variables

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `DCA_EXECUTOR_ADDRESS`: Smart contract address
- `RPC_URL`: Base network RPC endpoint
- `PRIVATE_KEY`: Wallet private key for transactions
- `ONEINCH_API_KEY`: 1inch API key for swap routing

## Database Schema

The `Token` model includes the following price-related fields:
- `price`: Current token price in USD
- `fdv`: Fully Diluted Valuation
- `marketcap`: Market capitalization
- `volume24h`: 24-hour trading volume
- `circulatingSupply`: Total circulating supply
- `price1yAgo`: 1-year ago price (manually updated)

## Error Handling

- Individual token update failures don't stop the entire process
- Rate limiting protection with 100ms delays between API calls
- Comprehensive logging for debugging and monitoring 