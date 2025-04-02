#!/usr/bin/env bun
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readdir, stat, readFile, writeFile } from "fs/promises";
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
function getContentType(filename: string): string {
  return MIME_TYPES[extname(filename).toLowerCase()] || 'application/octet-stream';
}
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

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

let file_hashes: Set<string> = new Set<string>();

async function getFileHash(filePath: string): Promise<string> {
  const content = await Bun.file(filePath).arrayBuffer();
  return createHash('sha256').update(Buffer.from(content)).digest('hex');
}

async function isHashExists(hash: string): Promise<boolean> {
  return file_hashes?.has(hash) || false;
}

async function recordHash(hash: string): Promise<void> {
  file_hashes.add(hash);
}

async function saveHash(): Promise<void> {
  console.log('Saving hash.bin...');
  const hash_binFile_path = join(process.cwd(), 'hash.bin');
  await writeFile(hash_binFile_path, [...file_hashes].join('\n'));
  console.log('hash.bin saved successfully!');
}

async function loadHash(): Promise<void> {
  console.log('Initializing hash.bin...');
  const hash_binFile_path = join(process.cwd(), 'hash.bin');
  const hashes = await readFile(hash_binFile_path, 'utf-8');
  file_hashes = new Set<string>(hashes.split('\n'));
}




async function uploadFile(bucket: string, filePath: string, key: string): Promise<void> {
  const hash = await getFileHash(filePath);

  if (await isHashExists(hash)) {
    console.log(`Skipping ${key} (already uploaded)`);
    return;
  }

  const fileContent = await Bun.file(filePath).arrayBuffer();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: new Uint8Array(fileContent),
    ContentType: getContentType(key)
  });

  await client.send(command);
  await recordHash(hash);
  console.log(`Uploaded ${key} and recorded hash`);
}

async function uploadDirectory(bucket: string, dirPath: string): Promise<void> {
  console.log(`Uploading ${dirPath}...`);
  const files = await readdir(dirPath);

  await Promise.all(files.map(async (file) => {
    const fullPath = join(dirPath, file);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      await uploadDirectory(bucket, fullPath);
    } else {
      const relativePath = relative(process.cwd(), fullPath);
      console.log(`Uploading ${relativePath}...`);
      await uploadFile(bucket, fullPath, relativePath);
    }
  }));
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
    await uploadDirectory(BUCKET_NAME, './book');
    console.log('Upload completed successfully!');
    await saveHash();
  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }
}

main();
