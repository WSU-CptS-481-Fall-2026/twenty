import { Logger } from '@nestjs/common';

import fs from 'fs';
import { readdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { type Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { ApiError, type Bucket, Storage } from '@google-cloud/storage';
import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { FILE_STORAGE_GCS_SLOW_REQUEST_THRESHOLD_MS } from 'src/engine/core-modules/file-storage/constants/gcs-slow-request-threshold.constant';
import { type StorageDriver } from 'src/engine/core-modules/file-storage/drivers/interfaces/storage-driver.interface';
import {
  FileStorageException,
  FileStorageExceptionCode,
} from 'src/engine/core-modules/file-storage/interfaces/file-storage-exception';
import { type ByteRange } from 'src/engine/core-modules/file-storage/types/byte-range.type';
import { type FileStorageMetadata } from 'src/engine/core-modules/file-storage/types/file-storage-metadata.type';

export type GcsDriverOptions = {
  bucketName: string;
  apiEndpoint?: string;
  presignEnabled?: boolean;
};

const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 900;

const isApiErrorWithCode = (error: unknown, code: number): boolean =>
  error instanceof ApiError && error.code === code;

const isNotFoundError = (error: unknown): boolean =>
  isApiErrorWithCode(error, 404);

const buildFileNotFoundException = () =>
  new FileStorageException(
    'File not found',
    FileStorageExceptionCode.FILE_NOT_FOUND,
  );

export class GcsDriver implements StorageDriver {
  private readonly bucket: Bucket;
  private readonly presignEnabled: boolean;
  private readonly logger = new Logger(GcsDriver.name);

  constructor({ bucketName, apiEndpoint, presignEnabled }: GcsDriverOptions) {
    this.bucket = new Storage({ apiEndpoint }).bucket(bucketName);
    this.presignEnabled = presignEnabled ?? false;
  }

  async readFile(params: {
    filePath: string;
    byteRange?: ByteRange;
  }): Promise<Readable> {
    const file = this.bucket.file(params.filePath);

    // The read stream only sends its request once it is consumed, so a missing
    // object would surface later as a stream error instead of FILE_NOT_FOUND.
    try {
      await file.getMetadata();
    } catch (error) {
      if (isNotFoundError(error)) {
        throw buildFileNotFoundException();
      }

      throw error;
    }

    return file.createReadStream(
      isDefined(params.byteRange)
        ? { start: params.byteRange.startByte, end: params.byteRange.endByte }
        : undefined,
    );
  }

  async readFilePrefix(params: {
    filePath: string;
    byteCount: number;
  }): Promise<Buffer> {
    try {
      return await this.measureRequest(
        { operation: 'DownloadPrefix', key: params.filePath },
        async () => {
          try {
            const [content] = await this.bucket
              .file(params.filePath)
              .download({ start: 0, end: params.byteCount - 1 });

            return content;
          } catch (error) {
            if (isApiErrorWithCode(error, 416)) {
              return Buffer.alloc(0);
            }

            throw error;
          }
        },
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        throw buildFileNotFoundException();
      }

      throw error;
    }
  }

  async writeFile(params: {
    filePath: string;
    sourceFile: Buffer | Uint8Array | string;
    mimeType: string | undefined;
  }): Promise<void> {
    await this.bucket.file(params.filePath).save(params.sourceFile, {
      contentType: params.mimeType,
      resumable: false,
    });
  }

  async writeFileStream(params: {
    filePath: string;
    stream: Readable;
    mimeType: string | undefined;
  }): Promise<void> {
    await pipeline(
      params.stream,
      this.bucket
        .file(params.filePath)
        .createWriteStream({ contentType: params.mimeType }),
    );
  }

  async getFileMetadata(params: {
    filePath: string;
  }): Promise<FileStorageMetadata | null> {
    return this.measureRequest(
      { operation: 'GetMetadata', key: params.filePath },
      async () => {
        try {
          const [metadata] = await this.bucket
            .file(params.filePath)
            .getMetadata();

          return {
            size: Number(metadata.size ?? 0),
            checksum: isDefined(metadata.generation)
              ? String(metadata.generation)
              : undefined,
          };
        } catch (error) {
          if (isNotFoundError(error)) {
            return null;
          }

          throw error;
        }
      },
    );
  }

  async move(params: {
    from: { folderPath: string; filename?: string };
    to: { folderPath: string; filename?: string };
    ifMatchChecksum?: string;
  }): Promise<void> {
    if (
      !isNonEmptyString(params.from.filename) ||
      !isNonEmptyString(params.to.filename)
    ) {
      await this.moveFolder({
        from: params.from.folderPath,
        to: params.to.folderPath,
      });

      return;
    }

    const fromKey = `${params.from.folderPath}/${params.from.filename}`;
    const toKey = `${params.to.folderPath}/${params.to.filename}`;

    if (!isDefined(params.ifMatchChecksum)) {
      await this.moveObject({ fromKey, toKey });

      return;
    }

    // The client drops a generation it cannot parse as a number, which would
    // turn the pinned copy below into an unconditional one.
    if (!/^\d+$/.test(params.ifMatchChecksum)) {
      throw new FileStorageException(
        `Object at ${fromKey} changed since it was inspected`,
        FileStorageExceptionCode.PRECONDITION_FAILED,
      );
    }

    // Pinning the source generation copies exactly the inspected bytes. Without
    // bucket versioning an overwritten generation no longer exists, so the
    // copy fails with a 404 rather than a 412.
    const pinnedSource = this.bucket.file(fromKey, {
      generation: params.ifMatchChecksum,
    });

    try {
      await pinnedSource.copy(toKey);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      const [currentSourceExists] = await this.bucket.file(fromKey).exists();

      if (currentSourceExists) {
        throw new FileStorageException(
          `Object at ${fromKey} changed since it was inspected`,
          FileStorageExceptionCode.PRECONDITION_FAILED,
        );
      }

      throw buildFileNotFoundException();
    }

    // Deleting by generation leaves a newer upload of the same path in place.
    await pinnedSource.delete({ ignoreNotFound: true });
  }

  async copy(params: {
    from: { folderPath: string; filename?: string };
    to: { folderPath: string; filename?: string };
  }): Promise<void> {
    if (
      !isNonEmptyString(params.from.filename) &&
      isNonEmptyString(params.to.filename)
    ) {
      throw new Error('Cannot copy folder to file');
    }

    if (isNonEmptyString(params.from.filename)) {
      await this.copyObject({
        fromKey: `${params.from.folderPath}/${params.from.filename}`,
        toKey: `${params.to.folderPath}/${params.to.filename}`,
      });

      return;
    }

    const files = await this.listFolder(params.from.folderPath);

    if (files.length === 0) {
      throw new Error(
        `No objects found in the source folder ${params.from.folderPath}/.`,
      );
    }

    for (const file of files) {
      await this.copyObject({
        fromKey: file.name,
        toKey: `${params.to.folderPath}/${this.toRelativeKey(params.from.folderPath, file.name)}`,
      });
    }
  }

  async delete(params: {
    folderPath: string;
    filename?: string;
  }): Promise<void> {
    if (isNonEmptyString(params.filename)) {
      await this.bucket
        .file(`${params.folderPath}/${params.filename}`)
        .delete({ ignoreNotFound: true });

      return;
    }

    await this.bucket.deleteFiles({ prefix: `${params.folderPath}/` });
  }

  async checkFileExists(params: { filePath: string }): Promise<boolean> {
    const [exists] = await this.bucket.file(params.filePath).exists();

    return exists;
  }

  async checkFolderExists(params: { folderPath: string }): Promise<boolean> {
    const [files] = await this.bucket.getFiles({
      prefix: `${params.folderPath}/`,
      maxResults: 1,
      autoPaginate: false,
    });

    return files.length > 0;
  }

  async downloadFile(params: {
    onStoragePath: string;
    localPath: string;
  }): Promise<void> {
    fs.mkdirSync(dirname(params.localPath), { recursive: true });

    await pipeline(
      await this.readFile({ filePath: params.onStoragePath }),
      fs.createWriteStream(params.localPath),
    );
  }

  async downloadFolder(params: {
    onStoragePath: string;
    localPath: string;
  }): Promise<void> {
    const files = await this.listFolder(params.onStoragePath);

    for (const file of files) {
      const localFilePath = join(
        params.localPath,
        this.toRelativeKey(params.onStoragePath, file.name),
      );

      await this.downloadFile({
        onStoragePath: file.name,
        localPath: localFilePath,
      });
    }
  }

  async uploadFolder(params: {
    localPath: string;
    onStoragePath: string;
  }): Promise<void> {
    const entries = await readdir(params.localPath, { withFileTypes: true });

    for (const entry of entries) {
      const localEntryPath = join(params.localPath, entry.name);

      if (entry.isDirectory()) {
        await this.uploadFolder({
          localPath: localEntryPath,
          onStoragePath: join(params.onStoragePath, entry.name),
        });
      } else {
        await this.writeFile({
          filePath: `${params.onStoragePath}/${entry.name}`,
          sourceFile: await readFile(localEntryPath),
          mimeType: undefined,
        });
      }
    }
  }

  async getPresignedUrl(params: {
    filePath: string;
    expiresInSeconds?: number;
    responseContentType?: string;
    responseContentDisposition?: string;
    responseCacheControl?: string;
  }): Promise<string | null> {
    if (!this.presignEnabled) {
      return null;
    }

    // V4 signed URLs have no response cache-control override, so
    // responseCacheControl is left to the object's own Cache-Control.
    const [url] = await this.bucket.file(params.filePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: this.buildSignedUrlExpiry(params.expiresInSeconds),
      responseType: params.responseContentType,
      responseDisposition: params.responseContentDisposition,
    });

    return url;
  }

  async getPresignedUploadUrl(params: {
    filePath: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<string | null> {
    if (!this.presignEnabled) {
      return null;
    }

    // Content-Type and Content-Length are part of the signature so the client
    // cannot upload a payload of a different type or size than declared.
    const [url] = await this.bucket.file(params.filePath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: this.buildSignedUrlExpiry(params.expiresInSeconds),
      contentType: params.contentType,
      extensionHeaders: { 'content-length': params.contentLength },
    });

    return url;
  }

  private async measureRequest<TResult>(
    { operation, key }: { operation: string; key: string },
    request: () => Promise<TResult>,
  ): Promise<TResult> {
    const startedAt = Date.now();

    try {
      const result = await request();
      const durationMs = Date.now() - startedAt;
      const message = `GCS ${operation} ${key} succeeded in ${durationMs}ms`;

      if (durationMs >= FILE_STORAGE_GCS_SLOW_REQUEST_THRESHOLD_MS) {
        this.logger.warn(message);
      } else {
        this.logger.debug(message);
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      this.logger.warn(
        `GCS ${operation} ${key} failed after ${durationMs}ms: ${error?.name ?? 'Error'} ${error?.message ?? ''}`,
      );

      throw error;
    }
  }

  private async moveObject({
    fromKey,
    toKey,
  }: {
    fromKey: string;
    toKey: string;
  }): Promise<void> {
    try {
      await this.bucket.file(fromKey).move(toKey);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw buildFileNotFoundException();
      }

      throw error;
    }
  }

  private async moveFolder({
    from,
    to,
  }: {
    from: string;
    to: string;
  }): Promise<void> {
    const files = await this.listFolder(from);

    if (files.length === 0) {
      throw new Error(`No objects found in the source folder ${from}.`);
    }

    for (const file of files) {
      await this.moveObject({
        fromKey: file.name,
        toKey: `${to}/${this.toRelativeKey(from, file.name)}`,
      });
    }
  }

  private async copyObject({
    fromKey,
    toKey,
  }: {
    fromKey: string;
    toKey: string;
  }): Promise<void> {
    try {
      await this.bucket.file(fromKey).copy(toKey);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw buildFileNotFoundException();
      }

      throw error;
    }
  }

  private async listFolder(folderPath: string) {
    const [files] = await this.bucket.getFiles({ prefix: `${folderPath}/` });

    return files;
  }

  private toRelativeKey(folderPath: string, key: string): string {
    return key.slice(folderPath.length + 1);
  }

  private buildSignedUrlExpiry(expiresInSeconds: number | undefined): number {
    return (
      Date.now() +
      (expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS) * 1000
    );
  }
}
