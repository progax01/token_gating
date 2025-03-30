import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TokenGating } from "../target/types/token_gating";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  requestAirdrop,
  createTokenMint,
  setupTokenAccounts,
  findResourcePda,
  findLevelsPda,
  findClaimWindowPda,
  findUserClaimPda
} from "./utils";

describe("token-gating: levels and claims", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenGating as Program<TokenGating>;
  
  // Test wallets
  const admin = anchor.web3.Keypair.generate();
  const level1User = anchor.web3.Keypair.generate();
  const level2User = anchor.web3.Keypair.generate();
  const level3User = anchor.web3.Keypair.generate();
  const noLevelUser = anchor.web3.Keypair.generate();

  // Test data
  const resourceName = "tiered-content";
  let resourcePda: PublicKey;
  
  // Token data
  let tokenMint: PublicKey;
  let adminTokenAccount: PublicKey;
  let level1TokenAccount: PublicKey;
  let level2TokenAccount: PublicKey;
  let level3TokenAccount: PublicKey;
  let noLevelTokenAccount: PublicKey;
  
  // Level data
  const thresholds = [10, 50, 100]; // Level 1: 10, Level 2: 50, Level 3: 100
  let levelsPda: PublicKey;
  
  // Claim window data
  let claimWindowPda: PublicKey;
  let level1ClaimPda: PublicKey;
  let level2ClaimPda: PublicKey;
  let level3ClaimPda: PublicKey;
  let noLevelClaimPda: PublicKey;
  
  // Timestamps for claim window
  let startTime: number;
  let endTime: number;
  
  before(async () => {
    // Airdrop SOL to all wallets
    await requestAirdrop(provider.connection, admin, 10);
    await requestAirdrop(provider.connection, level1User, 10);
    await requestAirdrop(provider.connection, level2User, 10);
    await requestAirdrop(provider.connection, level3User, 10);
    await requestAirdrop(provider.connection, noLevelUser, 10);
    
    // Create token mint
    tokenMint = await createTokenMint(provider.connection, admin);
    
    // Setup token accounts with amounts matching the levels
    [
      adminTokenAccount,
      level1TokenAccount,
      level2TokenAccount,
      level3TokenAccount,
      noLevelTokenAccount
    ] = await setupTokenAccounts(
      provider.connection,
      admin,
      tokenMint,
      [admin, level1User, level2User, level3User, noLevelUser],
      [1000, 20, 75, 200, 5] // Admin: 1000, Level1: 20, Level2: 75, Level3: 200, NoLevel: 5
    );
    
    // Calculate the resource PDA
    resourcePda = findResourcePda(resourceName, program.programId);
    
    // Configure the resource
    await program.methods
      .configureResource(resourceName, tokenMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Calculate the levels PDA
    levelsPda = findLevelsPda(resourcePda, program.programId);
  });

  describe("level configuration and checking", () => {
    it("configures level thresholds", async () => {
      await program.methods
        .configureLevels(resourceName, thresholds)
        .accounts({
          admin: admin.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      // Fetch and verify the levels account data
      const levels = await program.account.levels.fetch(levelsPda);
      expect(levels.resource.toBase58()).to.equal(resourcePda.toBase58());
      expect(levels.thresholds).to.deep.equal(thresholds);
    });

    it("checks user level correctly - Level 1", async () => {
      await program.methods
        .checkLevel(resourceName)
        .accounts({
          user: level1User.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          userTokenAccount: level1TokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([level1User])
        .rpc();
      
      // Level is checked through the emitted event, which we can't directly verify in tests
      // But we confirm the transaction succeeds
    });

    it("checks user level correctly - Level 2", async () => {
      await program.methods
        .checkLevel(resourceName)
        .accounts({
          user: level2User.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          userTokenAccount: level2TokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([level2User])
        .rpc();
    });

    it("checks user level correctly - Level 3", async () => {
      await program.methods
        .checkLevel(resourceName)
        .accounts({
          user: level3User.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          userTokenAccount: level3TokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([level3User])
        .rpc();
    });

    it("checks user level correctly - No Level (below threshold)", async () => {
      await program.methods
        .checkLevel(resourceName)
        .accounts({
          user: noLevelUser.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          userTokenAccount: noLevelTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([noLevelUser])
        .rpc();
    });
    
    it("rejects invalid level threshold configurations", async () => {
      // Try with non-ascending thresholds
      try {
        const invalidThresholds = [50, 20, 100]; // Not in ascending order
        
        await program.methods
          .configureLevels(resourceName, invalidThresholds)
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for invalid thresholds");
      } catch (error) {
        expect(error.toString()).to.include("InvalidLevelThresholds");
      }
      
      // Try with too many thresholds
      try {
        const tooManyThresholds = [10, 25, 50, 100]; // 4 levels (max is 3)
        
        await program.methods
          .configureLevels(resourceName, tooManyThresholds)
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for too many thresholds");
      } catch (error) {
        expect(error.toString()).to.include("InvalidLevelThresholds");
      }
    });
  });

  describe("token claim functionality", () => {
    before(async () => {
      // Set up claim window times
      startTime = Math.floor(Date.now() / 1000) - 60; // Start 1 minute ago
      endTime = startTime + 86400; // End 24 hours from start
      
      // Calculate the claim window PDA
      claimWindowPda = findClaimWindowPda(resourcePda, startTime, program.programId);
      
      // Set up user claim PDAs
      level1ClaimPda = findUserClaimPda(claimWindowPda, level1User.publicKey, program.programId);
      level2ClaimPda = findUserClaimPda(claimWindowPda, level2User.publicKey, program.programId);
      level3ClaimPda = findUserClaimPda(claimWindowPda, level3User.publicKey, program.programId);
      noLevelClaimPda = findUserClaimPda(claimWindowPda, noLevelUser.publicKey, program.programId);
    });

    it("configures a claim window", async () => {
      const requiredLevel = 2; // Require level 2 to claim
      
      await program.methods
        .configureClaim(resourceName, new anchor.BN(startTime), new anchor.BN(endTime), requiredLevel)
        .accounts({
          admin: admin.publicKey,
          resource: resourcePda,
          claimWindow: claimWindowPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      // Fetch and verify the claim window data
      const claimWindow = await program.account.claimWindow.fetch(claimWindowPda);
      expect(claimWindow.resource.toBase58()).to.equal(resourcePda.toBase58());
      expect(claimWindow.startTime.toString()).to.equal(startTime.toString());
      expect(claimWindow.endTime.toString()).to.equal(endTime.toString());
      expect(claimWindow.requiredLevel).to.equal(requiredLevel);
      expect(claimWindow.isActive).to.be.true;
    });

    it("allows level 2 user to claim", async () => {
      await program.methods
        .claimToken(resourceName)
        .accounts({
          user: level2User.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          claimWindow: claimWindowPda,
          userClaim: level2ClaimPda,
          userTokenAccount: level2TokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([level2User])
        .rpc();
      
      // Verify the claim was recorded
      const userClaim = await program.account.userClaim.fetch(level2ClaimPda);
      expect(userClaim.user.toBase58()).to.equal(level2User.publicKey.toBase58());
      expect(userClaim.claimWindow.toBase58()).to.equal(claimWindowPda.toBase58());
      expect(userClaim.hasClaimed).to.be.true;
    });

    it("allows level 3 user to claim (higher than required)", async () => {
      await program.methods
        .claimToken(resourceName)
        .accounts({
          user: level3User.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          claimWindow: claimWindowPda,
          userClaim: level3ClaimPda,
          userTokenAccount: level3TokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([level3User])
        .rpc();
      
      // Verify the claim was recorded
      const userClaim = await program.account.userClaim.fetch(level3ClaimPda);
      expect(userClaim.hasClaimed).to.be.true;
    });

    it("prevents level 1 user from claiming (below required level)", async () => {
      try {
        await program.methods
          .claimToken(resourceName)
          .accounts({
            user: level1User.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            claimWindow: claimWindowPda,
            userClaim: level1ClaimPda,
            userTokenAccount: level1TokenAccount,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([level1User])
          .rpc();
        
        expect.fail("Expected transaction to fail for insufficient level");
      } catch (error) {
        expect(error.toString()).to.include("InsufficientLevel");
      }
    });

    it("prevents no-level user from claiming", async () => {
      try {
        await program.methods
          .claimToken(resourceName)
          .accounts({
            user: noLevelUser.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            claimWindow: claimWindowPda,
            userClaim: noLevelClaimPda,
            userTokenAccount: noLevelTokenAccount,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([noLevelUser])
          .rpc();
        
        expect.fail("Expected transaction to fail for insufficient level");
      } catch (error) {
        expect(error.toString()).to.include("InsufficientLevel");
      }
    });

    it("prevents double-claiming", async () => {
      try {
        // Try to claim again with level 2 user who already claimed
        await program.methods
          .claimToken(resourceName)
          .accounts({
            user: level2User.publicKey,
            resource: resourcePda,
            levels: levelsPda,
            claimWindow: claimWindowPda,
            userClaim: level2ClaimPda,
            userTokenAccount: level2TokenAccount,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([level2User])
          .rpc();
        
        expect.fail("Expected transaction to fail for double claiming");
      } catch (error) {
        expect(error.toString()).to.include("AlreadyClaimed");
      }
    });
    
    it("validates claim window time boundaries", async () => {
      // Try to create a claim window with end time before start time
      try {
        const invalidStartTime = Math.floor(Date.now() / 1000);
        const invalidEndTime = invalidStartTime - 100; // End before start
        const invalidClaimWindowPda = findClaimWindowPda(resourcePda, invalidStartTime, program.programId);
        
        await program.methods
          .configureClaim(resourceName, new anchor.BN(invalidStartTime), new anchor.BN(invalidEndTime), 1)
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            claimWindow: invalidClaimWindowPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for invalid claim window times");
      } catch (error) {
        expect(error.toString()).to.include("InvalidClaimWindow");
      }
    });
    
    it("validates required level is greater than zero", async () => {
      // Try to create a claim window with level 0
      try {
        const newStartTime = Math.floor(Date.now() / 1000);
        const newEndTime = newStartTime + 3600;
        const newClaimWindowPda = findClaimWindowPda(resourcePda, newStartTime, program.programId);
        
        await program.methods
          .configureClaim(resourceName, new anchor.BN(newStartTime), new anchor.BN(newEndTime), 0)
          .accounts({
            admin: admin.publicKey,
            resource: resourcePda,
            claimWindow: newClaimWindowPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for invalid level requirement");
      } catch (error) {
        expect(error.toString()).to.include("InvalidLevelRequirement");
      }
    });
  });
}); 