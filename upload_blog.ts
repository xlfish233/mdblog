#!/usr/bin/env bun
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readdir, stat, readFile, writeFile, } from "fs/promises";
import { join, relative, extname } from "path";
import { createHash } from "crypto";

interface Config {
  endpoint: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  region: string;
}

const MIME_TYPES: Map<string, string> = new Map([
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'application/javascript'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.eot', 'application/vnd.ms-fontobject'],
]);

function getContentType(filename: string): string {
  return MIME_TYPES.get(extname(filename).toLowerCase()) || 'application/octet-stream';
}

const config: Config = {
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CF_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.CF_SECRET_ACCESS_KEY || '',
  },
  region: "auto",
};

const client = new S3Client(config);
const BUCKET_NAME = process.env.CF_BUCKET_NAME || '';
const UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY || './book';
let file_hashes: string[] = [];

async function isHashExists(hash: string): Promise<boolean> {
  return file_hashes.includes(hash);
}

async function recordHash(hash: string): Promise<void> {
  file_hashes.push(hash);
}

async function saveHash(): Promise<void> {
  console.log('Saving hash.bin...');
  try {
    const hash_binFile_path = join(process.cwd(), 'hash.bin');
    await writeFile(hash_binFile_path, file_hashes.join('\n'));
    console.log('hash.bin saved successfully!');
  } catch (error: any) {
    console.error(`Failed to save hash.bin: ${error.message}`);
    throw error;
  }
}

async function loadHash(): Promise<void> {
  console.log('Initializing hash.bin...');
  try {
    const hash_binFile_path = join(process.cwd(), 'hash.bin');
    const hashes = await readFile(hash_binFile_path, 'utf-8');
    file_hashes = hashes.split('\n');
  } catch (error: any) {
    file_hashes = [];
    console.error('Failed to read hash.bin:', error);
  }
}

async function uploadFile(bucket: string, filePath: string, key: string): Promise<void> {
  console.log(`Uploading ${key} to bucket ${bucket}`);
  try {
    // Read file content into a buffer
    const fileBuffer = await readFile(filePath);

    // Check size from buffer length
    if (fileBuffer.length === 0) {
      console.log(`Skipping ${key} (0 bytes)`);
      return;
    }

    // Calculate hash from the buffer
    console.log(`Calculating hash for ${key}`);
    const hash = createHash('sha256').update(fileBuffer).digest('hex');

    if (await isHashExists(hash)) {
      console.log(`Skipping ${key} (already uploaded)`);
      return;
    }

    const MAX_RETRIES = 3;
    const INITIAL_DELAY_MS = 1000;

    let lastError: any = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`Attempt ${attempt} to upload ${key}`);
      // Create command with the buffer for each attempt
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer, // Use the buffer directly
        ContentType: getContentType(key)
      });

      try {
        await client.send(command);
        // If successful, break the loop
        lastError = null; // Clear last error on success
        break;
      } catch (err: any) {
        lastError = err;
        console.error(`Error uploading ${key} (attempt ${attempt}):`, err);
        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // If all retries failed, throw the last encountered error
    if (lastError) {
      throw lastError;
    }
    await recordHash(hash);
    console.log(`Uploaded ${key} and recorded hash`);
  } catch (error: any) {
    console.error(`Failed to upload ${key}: ${error.message}`);
    throw error;
  }
}

async function uploadDirectory(bucket: string, dirPath: string): Promise<void> {
  console.log(`Uploading ${dirPath}...`);
  try {
    const files = await readdir(dirPath);

    const uploadPromises: Promise<void>[] = [];

    for (const file of files) {
      const fullPath = join(dirPath, file);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        uploadPromises.push(uploadDirectory(bucket, fullPath));
      } else {
        const relativePath = relative(process.cwd(), fullPath);
        console.log(`Uploading ${relativePath}...`);
        uploadPromises.push(uploadFile(bucket, fullPath, relativePath));
      }
    }

    await Promise.all(uploadPromises);
  } catch (error: any) {
    console.error(`Failed to upload directory ${dirPath}: ${error.message}`);
    throw error;
  }
}

async function main(): Promise<void> {
  if (!BUCKET_NAME) {
    console.error('Please set CF_BUCKET_NAME environment variable');
    process.exit(1);
  }
  try {
    await loadHash();
  } catch (error) {
    console.error('Failed to read hash.bin:', error);
    process.exit(1);
  }

  try {
    await uploadDirectory(BUCKET_NAME, UPLOAD_DIRECTORY);
    console.log('Upload completed successfully!');
    await saveHash();
  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }
}

main();
