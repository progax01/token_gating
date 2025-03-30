import { BN } from "bn.js";
import * as anchor from "@project-serum/anchor";
import { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

/**
 * Convert an array of numbers to BN array for Anchor program compatibility
 * @param numbers Array of numbers to convert
 * @returns Array of BN objects
 */
export function numbersToBNs(numbers: number[]): BN[] {
  return numbers.map(n => new BN(n));
}

/**
 * Find a program derived address (PDA)
 * @param seeds Array of seed buffers
 * @param programId Program ID
 * @returns The derived PDA
 */
export function findPDA(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

/**
 * Request an airdrop of SOL to a wallet
 * @param connection Solana connection
 * @param wallet Target wallet public key
 * @param amount Amount in SOL (not lamports)
 */
export async function requestAirdrop(
  connection: Connection, 
  wallet: PublicKey, 
  amount: number = 1
): Promise<string> {
  const signature = await connection.requestAirdrop(
    wallet, 
    amount * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(signature);
  return signature;
}

/**
 * Transfer SOL from one wallet to another
 * @param connection Solana connection
 * @param from Source keypair (must be funded)
 * @param to Destination public key
 * @param amount Amount in SOL (not lamports)
 */
export async function transferSOL(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  amount: number
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );
  const signature = await connection.sendTransaction(tx, [from]);
  await connection.confirmTransaction(signature);
  return signature;
}

/**
 * Create a new SPL token mint
 * @param connection Solana connection
 * @param payer Fee payer
 * @param mintAuthority Authority that can mint tokens
 * @returns The newly created mint address
 */
export async function createTokenMint(
  connection: Connection,
  payer: Keypair,
  mintAuthority: PublicKey = payer.publicKey
): Promise<PublicKey> {
  return await createMint(
    connection,
    payer,
    mintAuthority,
    null, // freeze authority (none)
    0 // decimals
  );
}

/**
 * Setup token accounts for users and mint initial token balances
 * @param connection Solana connection
 * @param payer Fee payer
 * @param mint Token mint
 * @param userWallets Array of user wallets
 * @param amounts Array of token amounts to mint to each user
 * @returns Object with token account addresses
 */
export async function setupTokenAccounts(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  userWallets: Keypair[],
  amounts: number[]
): Promise<PublicKey[]> {
  if (userWallets.length !== amounts.length) {
    throw new Error("Number of wallets must match number of amounts");
  }

  const tokenAccounts: PublicKey[] = [];

  for (let i = 0; i < userWallets.length; i++) {
    const tokenAccount = await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      userWallets[i].publicKey
    );
    
    if (amounts[i] > 0) {
      await mintTo(
        connection,
        payer,
        mint,
        tokenAccount,
        payer.publicKey,
        amounts[i]
      );
    }
    
    tokenAccounts.push(tokenAccount);
  }

  return tokenAccounts;
}

/**
 * Find a resource account PDA
 * @param resourceName Name of the resource
 * @param programId Program ID
 * @returns The resource PDA
 */
export function findResourcePda(resourceName: string, programId: PublicKey): PublicKey {
  return findPDA([Buffer.from(resourceName)], programId);
}

/**
 * Find a levels account PDA
 * @param resourcePda Resource PDA
 * @param programId Program ID
 * @returns The levels PDA
 */
export function findLevelsPda(resourcePda: PublicKey, programId: PublicKey): PublicKey {
  return findPDA([Buffer.from("levels"), resourcePda.toBuffer()], programId);
}

/**
 * Find a claim window PDA
 * @param resourcePda Resource PDA
 * @param startTime Start time for the claim window
 * @param programId Program ID
 * @returns The claim window PDA
 */
export function findClaimWindowPda(
  resourcePda: PublicKey,
  startTime: number,
  programId: PublicKey
): PublicKey {
  return findPDA(
    [Buffer.from("claim"), resourcePda.toBuffer(), new anchor.BN(startTime).toArrayLike(Buffer, "le", 8)],
    programId
  );
}

/**
 * Find a user claim PDA
 * @param claimWindowPda Claim window PDA
 * @param userPubkey User's public key
 * @param programId Program ID
 * @returns The user claim PDA
 */
export function findUserClaimPda(
  claimWindowPda: PublicKey,
  userPubkey: PublicKey,
  programId: PublicKey
): PublicKey {
  return findPDA(
    [Buffer.from("user_claim"), claimWindowPda.toBuffer(), userPubkey.toBuffer()],
    programId
  );
}

/**
 * Find an admin list PDA
 * @param programId Program ID
 * @returns The admin list PDA
 */
export function findAdminListPda(programId: PublicKey): PublicKey {
  return findPDA([Buffer.from("admin_list")], programId);
} 