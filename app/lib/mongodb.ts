import "server-only";

import { MongoClient, type Db } from "mongodb";

const DEFAULT_DATABASE = "bilads";

interface MongoConnection {
  uri: string;
  client: MongoClient;
  promise: Promise<MongoClient>;
}

const globalForMongo = globalThis as typeof globalThis & {
  biladsMongoConnection?: MongoConnection;
};

function mongoConfig(): { uri: string; database: string } {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MongoDB is not configured: set MONGODB_URI");
  }

  return {
    uri,
    database: process.env.MONGODB_DB?.trim() || DEFAULT_DATABASE,
  };
}

function connection(): MongoConnection {
  const { uri } = mongoConfig();
  const cached = globalForMongo.biladsMongoConnection;
  if (cached?.uri === uri) return cached;

  if (cached) void cached.client.close().catch(() => undefined);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  const next: MongoConnection = {
    uri,
    client,
    promise: client.connect(),
  };
  globalForMongo.biladsMongoConnection = next;

  void next.promise.catch(() => {
    if (globalForMongo.biladsMongoConnection === next) {
      delete globalForMongo.biladsMongoConnection;
    }
    void client.close().catch(() => undefined);
  });

  return next;
}

export function mongodbConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export async function mongoClient(): Promise<MongoClient> {
  return connection().promise;
}

export async function mongoDatabase(): Promise<Db> {
  const { database } = mongoConfig();
  return (await mongoClient()).db(database);
}

export async function pingMongoDB(): Promise<void> {
  await (await mongoDatabase()).command({ ping: 1 });
}
