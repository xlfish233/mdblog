# 项目规则与依赖说明

本文档记录项目中使用的一些规则和关键依赖。

## `upload_blog.ts` 脚本

该脚本用于将 `./book` 目录下的静态博客文件上传到 Cloudflare R2。

### 核心依赖与模块：

*   **`@aws-sdk/client-s3`**: 用于与 Cloudflare R2 (S3兼容接口) 进行交互，执行文件上传操作。
*   **Node.js `fs/promises`**: 用于异步读取文件系统，例如使用 `readdir`, `stat`, `readFile`, `writeFile`。在修复过程中，从 `fs.createReadStream` 改为使用 `readFile` 将文件读入 Buffer。
*   **Node.js `path`**: 用于处理和解析文件路径。
*   **Node.js `crypto`**: 用于计算文件的 SHA-256 哈希值，以判断文件是否已上传。
*   **`bun`**: 作为 TypeScript/JavaScript 运行时环境执行此脚本。

### 注意：

*   脚本依赖于环境变量来配置 Cloudflare R2 的凭证 (`CF_ACCOUNT_ID`, `CF_ACCESS_KEY_ID`, `CF_SECRET_ACCESS_KEY`) 和存储桶名称 (`CF_BUCKET_NAME`)。
*   脚本使用 `hash.bin` 文件来存储已上传文件的哈希值，避免重复上传。