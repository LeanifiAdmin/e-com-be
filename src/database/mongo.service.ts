import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { MongoClient, Db, Collection } from "mongodb";

const DEFAULT_MONGODB_URI =
  "mongodb+srv://shreya_db_user:ZKxDBZuuqmUkyrdk@cluster0.z4qpup8.mongodb.net/?appName=Cluster0";

@Injectable()
export class MongoService implements OnModuleDestroy {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private readyPromise: Promise<void> | null = null;

  async ensureConnected() {
    if (this.readyPromise) return this.readyPromise;

    const uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
    const dbName = process.env.MONGODB_DB || "test";

    this.readyPromise = (async () => {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db(dbName);
      // Sanity check for credentials/network errors.
      await this.db.command({ ping: 1 });
    })();

    return this.readyPromise;
  }

  getDb(): Db {
    if (!this.db) throw new Error("MongoDB not connected yet");
    return this.db;
  }

  collection<T = any>(name: string): Collection<T> {
    return this.getDb().collection<T>(name);
  }

  async onModuleDestroy() {
    if (this.client) await this.client.close();
  }
}

