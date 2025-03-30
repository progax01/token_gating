import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { 
  createMint, 
  mintTo as tokenMintTo, 
  burn, 
  getOrCreateAssociatedTokenAccount,
  createAccount,
  transfer
} from '@solana/spl-token';

export async function createNFT(
    admin: Keypair,
    connection: Connection
): Promise<PublicKey> {
    return await createMint(
        connection,
        admin,
        admin.publicKey,
        null,
        0 // 0 decimals for NFT
    );
}

export async function burnTokens(
    connection: Connection,
    owner: Keypair,
    tokenAccount: PublicKey,
    amount: number
): Promise<void> {
    await burn(
        connection,
        owner,
        tokenAccount,
        tokenAccount,
        owner,
        amount
    );
}

export async function mintTo(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number
): Promise<void> {
  await tokenMintTo(
    connection,
    payer,
    mint,
    destination,
    authority,
    amount
  );
}

export async function transferTokens(
    connection: Connection,
    owner: Keypair,
    source: PublicKey,
    destination: PublicKey,
    amount: number
): Promise<void> {
    await transfer(
        connection,
        owner,
        source,
        destination,
        owner,
        amount
    );
}

export async function createTokenAccount(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey
): Promise<PublicKey> {
    const account = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        owner
    );
    return account.address;
} 