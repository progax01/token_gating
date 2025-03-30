#!/bin/bash

# Token Gating Demo Script
PROGRAM_ID="DXqZwbkwKoMx84ibFpNaYTHVvLPLJHZPchhWw1nKsyex"

echo "=== Token Gating Program Demo ==="
echo "Program ID: $PROGRAM_ID"

# Make sure Anchor is built
if [ ! -f "./target/idl/token_gating.json" ]; then
  echo "Building Anchor program..."
  anchor build
fi

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
  echo "Solana CLI not found. Please install it first."
  exit 1
fi

# Check if SPL Token CLI is installed
if ! command -v spl-token &> /dev/null; then
  echo "SPL Token CLI not found. Please install it first."
  exit 1
fi

# Check Solana config
echo "Checking Solana configuration..."
SOLANA_NET=$(solana config get | grep "RPC URL" | awk '{print $3}')
echo "Network: $SOLANA_NET"

WALLET=$(solana config get | grep "Keypair Path" | awk '{print $3}')
echo "Wallet: $WALLET"

# Check account balance
BALANCE=$(solana balance)
echo "SOL Balance: $BALANCE"

# Request airdrop if on test network and balance is low
if [[ $SOLANA_NET == *"dev"* || $SOLANA_NET == *"test"* ]]; then
  if (( $(echo "$BALANCE < 1.0" | bc -l) )); then
    echo "Balance is low, requesting airdrop..."
    solana airdrop 2
    BALANCE=$(solana balance)
    echo "New SOL Balance: $BALANCE"
  fi
fi

# Create token for demonstration
echo -e "\n=== Creating SPL Token ==="
TOKEN_MINT=$(spl-token create-token | grep "Creating token" | awk '{print $3}')
echo "Token Mint: $TOKEN_MINT"

# Create token account
echo -e "\n=== Creating Token Account ==="
TOKEN_ACCOUNT=$(spl-token create-account $TOKEN_MINT | grep "Creating account" | awk '{print $3}')
echo "Token Account: $TOKEN_ACCOUNT"

# Mint tokens to our account
echo -e "\n=== Minting Tokens ==="
spl-token mint $TOKEN_MINT 1000
TOKEN_BALANCE=$(spl-token balance $TOKEN_MINT)
echo "Token Balance: $TOKEN_BALANCE"

# Configure resource
echo -e "\n=== Configuring Resource ==="
RESOURCE_NAME="Premium_Content"
echo "Resource Name: $RESOURCE_NAME"

# Use Anchor to call the program
echo "Calling configureResource..."
anchor_output=$(anchor exec --skip-build \
  --provider.cluster $SOLANA_NET \
  --provider.wallet $WALLET \
  "const anchor = require('@coral-xyz/anchor');
   const { PublicKey, SystemProgram } = require('@solana/web3.js');
   const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
   
   // Load the IDL
   const idl = require('./target/idl/token_gating.json');
   const programId = new PublicKey('$PROGRAM_ID');
   const program = new anchor.Program(idl, programId);
   
   async function main() {
     try {
       // Configure Resource
       const resourceName = '$RESOURCE_NAME';
       const tokenMint = new PublicKey('$TOKEN_MINT');
       const wallet = program.provider.wallet.publicKey;
       
       // Find resource PDA
       const [resourceAccount] = await PublicKey.findProgramAddress(
         [Buffer.from(resourceName)],
         program.programId
       );
       
       console.log('Configuring resource...');
       const tx1 = await program.methods
         .configureResource(resourceName, tokenMint)
         .accounts({
           admin: wallet,
           resource: resourceAccount,
           systemProgram: SystemProgram.programId
         })
         .rpc();
       
       console.log('Resource configured with tx:', tx1);
       
       // Configure Levels
       const thresholds = [10, 100, 500];
       const [levelsAccount] = await PublicKey.findProgramAddress(
         [Buffer.from('levels'), resourceAccount.toBuffer()],
         program.programId
       );
       
       console.log('Configuring levels...');
       const tx2 = await program.methods
         .configureLevels(resourceName, thresholds)
         .accounts({
           admin: wallet,
           resource: resourceAccount,
           levels: levelsAccount,
           systemProgram: SystemProgram.programId
         })
         .rpc();
       
       console.log('Levels configured with tx:', tx2);
       
       // Get the token account
       const tokenAccount = new PublicKey('$TOKEN_ACCOUNT');
       
       // Check level
       console.log('Checking level...');
       const tx3 = await program.methods
         .checkLevel(resourceName)
         .accounts({
           user: wallet,
           resource: resourceAccount,
           levels: levelsAccount,
           userTokenAccount: tokenAccount,
           tokenProgram: TOKEN_PROGRAM_ID
         })
         .rpc();
       
       console.log('Level checked with tx:', tx3);
       
       // Configure claim window
       const now = Math.floor(Date.now() / 1000);
       const startTime = now;
       const endTime = now + 86400; // 24 hours
       const requiredLevel = 2;
       
       const [claimWindowAccount] = await PublicKey.findProgramAddress(
         [
           Buffer.from('claim'),
           resourceAccount.toBuffer(),
           Buffer.from(new anchor.BN(startTime).toArray('le', 8))
         ],
         program.programId
       );
       
       console.log('Configuring claim window...');
       const tx4 = await program.methods
         .configureClaim(resourceName, new anchor.BN(startTime), new anchor.BN(endTime), requiredLevel)
         .accounts({
           admin: wallet,
           resource: resourceAccount,
           claimWindow: claimWindowAccount,
           systemProgram: SystemProgram.programId
         })
         .rpc();
       
       console.log('Claim window configured with tx:', tx4);
       
       // Claim tokens
       const [userClaimAccount] = await PublicKey.findProgramAddress(
         [
           Buffer.from('user_claim'),
           claimWindowAccount.toBuffer(),
           wallet.toBuffer()
         ],
         program.programId
       );
       
       console.log('Claiming tokens...');
       const tx5 = await program.methods
         .claimToken(resourceName)
         .accounts({
           user: wallet,
           resource: resourceAccount,
           levels: levelsAccount,
           claimWindow: claimWindowAccount,
           userClaim: userClaimAccount,
           userTokenAccount: tokenAccount,
           systemProgram: SystemProgram.programId,
           tokenProgram: TOKEN_PROGRAM_ID
         })
         .rpc();
       
       console.log('Tokens claimed with tx:', tx5);
       
       // Verify access
       console.log('Verifying access...');
       const tx6 = await program.methods
         .verifyAccess(resourceName)
         .accounts({
           user: wallet,
           resource: resourceAccount,
           userTokenAccount: tokenAccount,
           tokenProgram: TOKEN_PROGRAM_ID
         })
         .rpc();
       
       console.log('Access verified with tx:', tx6);
       
       console.log('Demo completed successfully!');
     } catch (error) {
       console.error('Error:', error);
     }
   }
   
   main();" 2>&1)

echo "$anchor_output"

echo -e "\n=== Demo Complete ==="
echo "The token gating program has been successfully demonstrated!" 