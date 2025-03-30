import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TokenGating } from "../target/types/token_gating";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("token-gating-errors", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenGating as Program<TokenGating>;
  
  // Test wallets
  const admin = anchor.web3.Keypair.generate();
  const user = anchor.web3.Keypair.generate();
  const nonAdmin = anchor.web3.Keypair.generate();

  // Test data
  const resourceName = "error-tests";
  let resourcePda: PublicKey;
  let tokenMint: PublicKey;
  let userTokenAccount: PublicKey;
  let userEmptyTokenAccount: PublicKey;
  let levelsPda: PublicKey;
  let adminListPda: PublicKey;
  
  // For the empty token account we'll create a user with 0 tokens
  const userWithNoTokens = anchor.web3.Keypair.generate();

  before(async () => {
    // Airdrop SOL to wallets
    const signatures = await Promise.all([
      provider.connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(nonAdmin.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(userWithNoTokens.publicKey, 10 * LAMPORTS_PER_SOL),
    ]);
    
    // Wait for confirmations
    await Promise.all(signatures.map(sig => provider.connection.confirmTransaction(sig)));
    
    // Create mint
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      0
    );
    
    // Create token accounts
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      user.publicKey
    );
    
    userEmptyTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      userWithNoTokens.publicKey
    );
    
    // Mint tokens - user gets 10 tokens, empty account gets 0
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      userTokenAccount,
      admin.publicKey,
      10
    );
    
    // Calculate PDAs
    resourcePda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(resourceName)],
      program.programId
    )[0];
    
    levelsPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("levels"), resourcePda.toBuffer()],
      program.programId
    )[0];
    
    adminListPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("admin_list")],
      program.programId
    )[0];
    
    // Setup for tests - configure the resource
    await program.methods
      .configureResource(resourceName, tokenMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
      
    // Setup levels
    await program.methods
      .configureLevels(resourceName, [5, 50, 100])
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  });

  describe("Resource validation errors", () => {
    it("Rejects empty resource name", async () => {
      const emptyName = "";
      const emptyResourcePda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(emptyName)],
        program.programId
      )[0];
      
      try {
        await program.methods
          .configureResource(emptyName, tokenMint)
          .accounts({
            admin: admin.publicKey,
            resource: emptyResourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for empty resource name");
      } catch (error) {
        expect(error.toString()).to.include("ResourceNameEmpty");
      }
    });
    
    it("Rejects too long resource name", async () => {
      const longName = "this-resource-name-is-way-too-long-for-the-program-restrictions";
      const longResourcePda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(longName)],
        program.programId
      )[0];
      
      try {
        await program.methods
          .configureResource(longName, tokenMint)
          .accounts({
            admin: admin.publicKey,
            resource: longResourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for long resource name");
      } catch (error) {
        expect(error.toString()).to.include("ResourceNameTooLong");
      }
    });
    
    it("Rejects invalid characters in resource name", async () => {
      const invalidName = "invalid!@#$%name";
      const invalidResourcePda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(invalidName)],
        program.programId
      )[0];
      
      try {
        await program.methods
          .configureResource(invalidName, tokenMint)
          .accounts({
            admin: admin.publicKey,
            resource: invalidResourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for invalid resource name");
      } catch (error) {
        expect(error.toString()).to.include("InvalidResourceName");
      }
    });
  });
  
  describe("Access control errors", () => {
    it("Rejects non-admin resource update", async () => {
      try {
        await program.methods
          .updateResource(resourceName, tokenMint)
          .accounts({
            admin: nonAdmin.publicKey,
            resource: resourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([nonAdmin])
          .rpc();
          
        expect.fail("Should have thrown an error for non-admin update");
      } catch (error) {
        expect(error.toString()).to.include("AdminPermissionDenied");
      }
    });
    
    it("Rejects incorrect token account owner", async () => {
      try {
        await program.methods
          .verifyAccess(resourceName)
          .accounts({
            user: admin.publicKey, // Admin trying to use user's token account
            resource: resourcePda,
            userTokenAccount: userTokenAccount, // This belongs to user, not admin
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for incorrect token account owner");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTokenAccountOwner");
      }
    });
    
    it("Rejects access with insufficient tokens", async () => {
      try {
        await program.methods
          .verifyAccess(resourceName)
          .accounts({
            user: userWithNoTokens.publicKey,
            resource: resourcePda,
            userTokenAccount: userEmptyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([userWithNoTokens])
          .rpc();
          
        expect.fail("Should have thrown an error for insufficient tokens");
      } catch (error) {
        expect(error.toString()).to.include("InsufficientTokenBalance");
      }
    });
  });
  
  describe("Claim window errors", () => {
    it("Rejects invalid claim window time range", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = currentTime + 1000; // Future start
      const endTime = currentTime + 500; // End before start
      
      const invalidClaimWindowPda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), resourcePda.toBuffer(), new anchor.BN(startTime).toArrayLike(Buffer, "le", 8)],
        program.programId
      )[0];
      
      try {
        await program.methods
          .configureClaim(resourceName, new anchor.BN(startTime), new anchor.BN(endTime), 1)
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            claimWindow: invalidClaimWindowPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for invalid claim window times");
      } catch (error) {
        expect(error.toString()).to.include("InvalidClaimWindow");
      }
    });
    
    it("Rejects invalid level requirement", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = currentTime;
      const endTime = currentTime + 86400;
      
      const claimWindowPda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), resourcePda.toBuffer(), new anchor.BN(startTime).toArrayLike(Buffer, "le", 8)],
        program.programId
      )[0];
      
      try {
        await program.methods
          .configureClaim(resourceName, new anchor.BN(startTime), new anchor.BN(endTime), 0) // Level must be > 0
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            claimWindow: claimWindowPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for invalid level requirement");
      } catch (error) {
        expect(error.toString()).to.include("InvalidLevelRequirement");
      }
    });
  });
  
  describe("Level configuration errors", () => {
    it("Rejects non-ascending level thresholds", async () => {
      try {
        await program.methods
          .configureLevels(resourceName, [100, 50, 200]) // Not in ascending order
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for non-ascending thresholds");
      } catch (error) {
        expect(error.toString()).to.include("InvalidLevelThresholds");
      }
    });
    
    it("Rejects too many level thresholds", async () => {
      try {
        await program.methods
          .configureLevels(resourceName, [10, 20, 30, 40]) // More than 3 levels
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
          
        expect.fail("Should have thrown an error for too many thresholds");
      } catch (error) {
        expect(error.toString()).to.include("InvalidLevelThresholds");
      }
    });
  });
}); 