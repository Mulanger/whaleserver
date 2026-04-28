import { MongoClient, Db } from 'mongodb';
import { config } from '../config.js';
import { logger } from '../logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(config.MONGO_URI);
  await client.connect();
  db = client.db(config.MONGO_DB);
  logger.info('connected to MongoDB');
  return db;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected');
  return db;
}

export function getClient(): MongoClient {
  if (!client) throw new Error('MongoClient not connected');
  return client;
}