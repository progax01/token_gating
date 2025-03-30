# Token Gating Program Tests

This directory contains various test suites for the Token Gating Anchor program. The tests are organized to test different aspects of the program's functionality.

## Test Organization

### Mock Tests (No Validator Required)

These tests do not require a running Solana validator and can be run quickly to verify basic logic:

1. **simple-anchor.ts** - Basic tests that verify keypair generation and mock token verification
2. **edge-cases.ts** - Comprehensive negative tests for edge cases and error conditions
3. **claim-window-tests.ts** - Tests focused on the claim window functionality
4. **admin-tests.ts** - Tests for admin management functionality
5. **verify-test.ts** - Tests focused on token verification functionality
6. **token-gating-simple.ts** - Tests for token gating core functionality

### Full Tests (Validator Required)

These tests require a running Solana validator:

1. **token-gating-basic.ts** - Integration tests for basic token gating functionality
2. **token-gating-errors.ts** - Error handling tests with actual validator
3. **token-levels.ts** - Tests for level-based access functionality
4. **admin-management.ts** - Tests for admin management with real accounts
5. **resource-access.ts** - Tests for resource access control
6. **token-gating.ts** - Comprehensive end-to-end tests

## Running the Tests

### Running Mock Tests (No Validator Required)

These commands will run the mock tests without needing a Solana validator:

```bash
# Run individual mock tests
anchor run simple-test    # Basic tests
anchor run anchor-test    # Simple anchor tests
anchor run edge-test      # Edge cases and error conditions
anchor run claim-test     # Claim window functionality
anchor run admin-test     # Admin management
anchor run verify-test    # Token verification
anchor run token-test     # Token gating functionality

# Run all mock tests together
anchor run all-mocks
```

### Running Full Tests (Validator Required)

For running full tests with a validator:

```bash
# Start the Solana test validator
solana-test-validator

# Run the tests
anchor test
```

## Test Coverage

The test suites cover the following aspects of the token gating program:

### Basic Functionality
- Resource configuration and updates
- Token verification for access
- Level-based access control
- Claim window setup and verification

### Error Handling
- Empty resource names
- Too long resource names
- Invalid resource name characters
- Insufficient token balances
- Invalid level thresholds
- Unauthorized admin operations
- Claims outside of valid time windows
- Token account ownership verification
- Token mint verification

### Edge Cases
- Boundary conditions for resource names
- Minimum token balances
- Exact timing for claim windows
- Admin management edge cases
  - Adding/removing admins
  - Capacity limits
  - Self-removal
  - Re-adding removed admins

## Mock/Simplification Strategy

The mock tests implement a simplified version of the program's logic that can be tested without requiring a Solana validator. This provides quick feedback during development and allows testing error conditions that might be difficult to trigger in a live environment.

These tests use:
1. Mock keypairs generated on-the-fly
2. Simulated PDAs derived from seeds
3. Exception-based verification of program constraints
4. In-memory simulation of token balances and admin lists 