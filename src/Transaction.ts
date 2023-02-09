import axios from "axios";
import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";
import { Trigger } from "@prisma/client";
import { User } from "@prisma/client";

type HookResponse = {
  transactionHash: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  chainId: number;
  data: string;
  gasLimit: string;
};

export default class Transaction {
  prisma: PrismaClient;
  provider: ethers.providers.JsonRpcProvider;
  blockNumber: number;

  constructor(_rpcUrl: string) {
    this.prisma = new PrismaClient();
    this.provider = new ethers.providers.JsonRpcProvider(_rpcUrl);
    this.blockNumber = 0;
  }

  // keep the fire growing deep inside... hell awaits
  async emit(_blockNumber: number) {
    this.getTransactionHashes(_blockNumber).then((transactionHashes) => {
      transactionHashes.forEach((transactionHash) => {
        this.getTransactionResponse(transactionHash).then((transactionResponse) => {
          this.queryDatabase(transactionResponse).then((triggers) => {
            triggers.forEach((trigger) => {
              const hookResponse: HookResponse = this.getHookResponse(transactionResponse);
              this.emitHookResponse(trigger, hookResponse);
              this.incrementCredits(trigger);
            });
          });
        });
      });
    });
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getTransactionHashes(_blockNumber: number): Promise<string[]> {
    const block: ethers.providers.Block = await this.provider.getBlock(_blockNumber);
    const transactionHashes: string[] = block.transactions;
    return transactionHashes;
  }

  async getTransactionResponse(_transactionHash: string): Promise<ethers.providers.TransactionResponse> {
    const transactionResponse: ethers.providers.TransactionResponse = await this.provider.getTransaction(_transactionHash);
    return transactionResponse;
  }

  async queryDatabase(_transaction: ethers.providers.TransactionResponse): Promise<Trigger[]> {
    // SELECT * FROM triggers WHERE chainId = _transaction.chainId AND abi IS NULL AND (address = _transaction.from OR address = _transaction.to) AND (user.credits <= 1000 OR user.paid = true)
    return await this.prisma.trigger.findMany({
      where: {
        chainId: _transaction.chainId,
        abi: null,
        AND: [
          {
            AND: [
              {
                address: _transaction.from.toLowerCase(),
              },
              {
                address: _transaction.to ? _transaction.to.toLowerCase() : "",
              },
            ],
          },
          {
            OR: [
              {
                user: {
                  credits: {
                    lte: 1000,
                  },
                },
              },
              {
                user: {
                  paid: true,
                },
              },
            ],
          },
        ],
      },
    });
  }

  async incrementCredits(_trigger: Trigger): Promise<User> {
    return await this.prisma.user.update({
      where: {
        id: _trigger.userId,
      },
      data: {
        credits: {
          increment: 1,
        },
      },
    });
  }

  getHookResponse(_transaction: ethers.providers.TransactionResponse): HookResponse {
    return {
      fromAddress: _transaction.from,
      toAddress: _transaction.to ? _transaction.to.toLowerCase() : "",
      value: ethers.BigNumber.from(_transaction.value).toString(),
      transactionHash: _transaction.hash,
      chainId: _transaction.chainId,
      data: _transaction.data,
      gasLimit: _transaction.gasLimit.toString(),
    };
  }

  emitHookResponse(_trigger: Trigger, _hookResponse: HookResponse): void {
    axios.post(_trigger.webhookUrl, _hookResponse);
  }
}
