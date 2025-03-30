import { Keypair, Connection, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createMint, mintTo } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import TokenGatingClient from './token-gating-client';

async function runDemo() {
  console.log('Starting Token Gating Demo...');

  // Connect to Solana devnet
  const connection = new Connection(clusterApiUrl('localnet'), 'confirmed');
  
  // Load or create a keypair
  let keypair: Keypair;
  const keypairPath = path.resolve(__dirname, '/home/admin/.config/solana/id.json n');
  
  if (fs.existsSync(keypairPath)) {
    console.log('Loading existing keypair...');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  } else {
    console.log('Creating new keypair...');
    keypair = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  }
  
  const wallet = new anchor.Wallet(keypair);
  console.log(`Wallet public key: ${wallet.publicKey.toString()}`);
  
  // Check SOL balance and request airdrop if needed
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < LAMPORTS_PER_SOL) {
    console.log('Requesting SOL airdrop...');
    const signature = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature);
    console.log(`Airdropped 1 SOL to ${wallet.publicKey.toString()}`);
  }
  
  // Initialize the client
  const client = new TokenGatingClient(connection, wallet);
  
  try {
    // Demo 1: Create a token and configure resource
    console.log('\n === Demo 1: Basic Token Gating === ');
    
    // Create a new token mint
    console.log('Creating token mint...');
    const mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9 // decimals
    );
    console.log(`Token mint created: ${mint.toString()}`);
    
    // Create user token account
    console.log('Creating token account...');
    const tokenAccount = await client.getOrCreateTokenAccount(mint);
    console.log(`Token account: ${tokenAccount.toString()}`);
    
    // Mint some tokens to the user
    console.log('Minting tokens...');
    const amount = 100 * 10**9; // 100 tokens with 9 decimals
    await mintTo(
      connection,
      wallet.payer,
      mint,
      tokenAccount,
      wallet.payer,
      amount
    );
    
    const tokenBalance = await client.getTokenBalance(tokenAccount);
    console.log(`Token balance: ${tokenBalance / 10**9} tokens`);
    
    // Configure a resource that requires this token
    const resourceName = "Premium Content";
    console.log(`Configuring resource: ${resourceName}`);
    await client.configureResource(resourceName, mint);
    
    // Verify access to the resource
    console.log('Verifying access...');
    await client.verifyAccess(resourceName, tokenAccount);
    console.log('Access verified successfully!');
    
    // Demo 2: Token Levels
    console.log('\n === Demo 2: Token Levels === ');
    
    // Configure levels for the resource
    const thresholds = [10, 50, 100];
    console.log(`Configuring levels with thresholds: ${thresholds.join(', ')}`);
    await client.configureLevels(resourceName, thresholds);
    
    // Check user's level
    console.log('Checking user level...');
    await client.checkLevel(resourceName, tokenAccount);
    console.log('Level check successful!');
    
    // Demo 3: Token Claiming
    console.log('\n === Demo 3: Token Claiming === ');
    
    // Configure a claim window
    const now = Math.floor(Date.now() / 1000);
    const startTime = now;
    const endTime = now + 86400; // 24 hours
    const requiredLevel = 3; // Highest level
    
    console.log(`Configuring claim window (required level: ${requiredLevel})`);
    await client.configureClaim(resourceName, startTime, endTime, requiredLevel);
    
    // Claim tokens (this should succeed since we have 100 tokens, meeting level 3)
    console.log('Claiming tokens...');
    await client.claimToken(resourceName, tokenAccount, startTime);
    console.log('Tokens claimed successfully!');
    
    // Demo 4: Admin Management
    console.log('\n === Demo 4: Admin Management === ');
    
    // Generate a new admin keypair
    const newAdminKeypair = Keypair.generate();
    console.log(`Generated new admin: ${newAdminKeypair.publicKey.toString()}`);
    
    // Add the new admin
    console.log('Adding new admin...');
    await client.addAdmin(newAdminKeypair.publicKey);
    
    // Remove the admin
    console.log('Removing admin...');
    await client.removeAdmin(newAdminKeypair.publicKey);
    
    console.log('\nAll demos completed successfully!');
    
  } catch (error) {
    console.error('Error during demonstration:', error);
  }
}

// Run the demo
runDemo().catch(console.error); 