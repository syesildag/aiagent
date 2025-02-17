import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
   user: process.env.DB_USER,
   host: process.env.DB_HOST,
   database: process.env.DB_NAME,
   password: process.env.DB_PASSWORD,
   port: Number(process.env.DB_PORT),
});

export const queryDB = async (query: string, values: any[] = []) => {
   const client = await pool.connect();
   try {
      const res = await client.query(query, values);
      return res.rows;
   } finally {
      client.release();
   }
};