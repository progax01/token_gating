import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, createMint, mintTo, getAccount } from '@solana/spl-token';
import { BN } from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

// Program ID from your Solana program
const PROGRAM_ID = new PublicKey('DXqZwbkwKoMx84ibFpNaYTHVvLPLJHZPchhWw1nKsyex');

// Client class to interact with the token gating program
export class TokenGatingClient {
  program: anchor.Program;
  connection: Connection;
  wallet: anchor.Wallet;
  provider: anchor.AnchorProvider;

  constructor(
    connection: Connection, 
    wallet: anchor.Wallet,
    confirmOptions?: anchor.web3.ConfirmOptions
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.provider = new anchor.AnchorProvider(
      connection, 
      wallet,
      confirmOptions || anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(this.provider);
    
    // Load the IDL directly from the file
    const idlFile = require('../target/idl/token_gating.json');
    this.program = new anchor.Program(idlFile, PROGRAM_ID, this.provider);
  }

  // Helper to find a PDA for a resource
  async findResourceAddress(resourceName: string): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from(resourceName)],
      this.program.programId
    );
  }

  // Helper to find a PDA for levels
  async findLevelsAddress(resourceAccount: PublicKey): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from('levels'), resourceAccount.toBuffer()],
      this.program.programId
    );
  }

  // Helper to find a PDA for claim window
  async findClaimWindowAddress(
    resourceAccount: PublicKey, 
    startTime: number
  ): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [
        Buffer.from('claim'), 
        resourceAccount.toBuffer(), 
        new BN(startTime).toArrayLike(Buffer, 'le', 8)
      ],
      this.program.programId
    );
  }

  // Helper to find a PDA for user claim
  async findUserClaimAddress(
    claimWindowAccount: PublicKey, 
    userPublicKey: PublicKey
  ): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [
        Buffer.from('user_claim'), 
        claimWindowAccount.toBuffer(), 
        userPublicKey.toBuffer()
      ],
      this.program.programId
    );
  }

  // 1A: Configure a new resource-token mapping
  async configureResource(
    resourceName: string, 
    requiredMint: PublicKey
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);

    const tx = await this.program.methods
      .configureResource(resourceName, requiredMint)
      .accounts({
        admin: this.wallet.publicKey,
        resource: resourceAccount,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    console.log(`Resource "${resourceName}" configured with transaction: ${tx}`);
    return tx;
  }

  // 1A: Update an existing resource-token mapping
  async updateResource(
    resourceName: string, 
    newMint: PublicKey
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);

    const tx = await this.program.methods
      .updateResource(resourceName, newMint)
      .accounts({
        admin: this.wallet.publicKey,
        resource: resourceAccount,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    console.log(`Resource "${resourceName}" updated with transaction: ${tx}`);
    return tx;
  }

  // 1B: Verify user access to a resource
  async verifyAccess(
    resourceName: string, 
    userTokenAccount: PublicKey
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);

    try {
      const tx = await this.program.methods
        .verifyAccess(resourceName)
        .accounts({
          user: this.wallet.publicKey,
          resource: resourceAccount,
          userTokenAccount: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID
        })
        .rpc();

      console.log(`Access verified for resource "${resourceName}" with transaction: ${tx}`);
      return tx;
    } catch (error) {
      console.error(`Access denied for resource "${resourceName}": ${error}`);
      throw error;
    }
  }

  // 2A: Configure level thresholds for a resource
  async configureLevels(
    resourceName: string, 
    thresholds: number[]
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);
    const [levelsAccount] = await this.findLevelsAddress(resourceAccount);

    const tx = await this.program.methods
      .configureLevels(resourceName, thresholds.map(t => new BN(t)))
      .accounts({
        admin: this.wallet.publicKey,
        resource: resourceAccount,
        levels: levelsAccount,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    console.log(`Levels configured for resource "${resourceName}" with transaction: ${tx}`);
    return tx;
  }

  // 2A: Check user level based on token balance
  async checkLevel(
    resourceName: string, 
    userTokenAccount: PublicKey
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);
    const [levelsAccount] = await this.findLevelsAddress(resourceAccount);

    const tx = await this.program.methods
      .checkLevel(resourceName)
      .accounts({
        user: this.wallet.publicKey,
        resource: resourceAccount,
        levels: levelsAccount,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .rpc();

    console.log(`Level checked for resource "${resourceName}" with transaction: ${tx}`);
    return tx;
  }

  // 2B: Configure a token claim window
  async configureClaim(
    resourceName: string, 
    startTime: number, 
    endTime: number, 
    requiredLevel: number
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);
    const [claimWindowAccount] = await this.findClaimWindowAddress(resourceAccount, startTime);

    const tx = await this.program.methods
      .configureClaim(resourceName, new BN(startTime), new BN(endTime), requiredLevel)
      .accounts({
        admin: this.wallet.publicKey,
        resource: resourceAccount,
        claimWindow: claimWindowAccount,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    console.log(`Claim window configured for resource "${resourceName}" with transaction: ${tx}`);
    return tx;
  }

  // 2B: Claim a token reward
  async claimToken(
    resourceName: string, 
    userTokenAccount: PublicKey,
    claimWindowStartTime: number
  ): Promise<string> {
    const [resourceAccount] = await this.findResourceAddress(resourceName);
    const [levelsAccount] = await this.findLevelsAddress(resourceAccount);
    const [claimWindowAccount] = await this.findClaimWindowAddress(resourceAccount, claimWindowStartTime);
    const [userClaimAccount] = await this.findUserClaimAddress(claimWindowAccount, this.wallet.publicKey);

    const tx = await this.program.methods
      .claimToken(resourceName)
      .accounts({
        user: this.wallet.publicKey,
        resource: resourceAccount,
        levels: levelsAccount,
        claimWindow: claimWindowAccount,
        userClaim: userClaimAccount,
        userTokenAccount: userTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .rpc();

    console.log(`Token claimed for resource "${resourceName}" with transaction: ${tx}`);
    return tx;
  }

  // Add admin function
  async addAdmin(newAdmin: PublicKey): Promise<string> {
    const [adminListAccount] = await PublicKey.findProgramAddress(
      [Buffer.from('admin_list')],
      this.program.programId
    );

    const tx = await this.program.methods
      .addAdmin(newAdmin)
      .accounts({
        admin: this.wallet.publicKey,
        adminList: adminListAccount,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    console.log(`Admin added with transaction: ${tx}`);
    return tx;
  }

  // Remove admin function
  async removeAdmin(adminToRemove: PublicKey): Promise<string> {
    const [adminListAccount] = await PublicKey.findProgramAddress(
      [Buffer.from('admin_list')],
      this.program.programId
    );

    const tx = await this.program.methods
      .removeAdmin(adminToRemove)
      .accounts({
        admin: this.wallet.publicKey,
        adminList: adminListAccount,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    console.log(`Admin removed with transaction: ${tx}`);
    return tx;
  }

  // Helper to get or create a token account
  async getOrCreateTokenAccount(
    mint: PublicKey, 
    owner: PublicKey = this.wallet.publicKey
  ): Promise<PublicKey> {
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.wallet.payer,
      mint,
      owner
    );
    return tokenAccount.address;
  }

  // Helper to check token balance
  async getTokenBalance(tokenAccount: PublicKey): Promise<number> {
    const account = await getAccount(this.connection, tokenAccount);
    return Number(account.amount);
  }
}

// Export the client class for use in other modules
export default TokenGatingClient; 