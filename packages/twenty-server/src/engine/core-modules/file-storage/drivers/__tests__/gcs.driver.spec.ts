import { Logger } from '@nestjs/common';

import { ApiError, Storage } from '@google-cloud/storage';

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Readable, Writable } from 'stream';

import { FileStorageExceptionCode } from 'src/engine/core-modules/file-storage/interfaces/file-storage-exception';

import { GcsDriver } from 'src/engine/core-modules/file-storage/drivers/gcs.driver';
import { streamToBuffer } from 'src/utils/stream-to-buffer';

jest.mock('@google-cloud/storage', () => {
  const actual = jest.requireActual('@google-cloud/storage');

  return { ...actual, Storage: jest.fn() };
});

type StoredObject = {
  content: Buffer;
  generation: number;
  contentType?: string;
};

type RecordedSignedUrl = { name: string } & Record<string, unknown>;

const apiError = (code: number) =>
  Object.assign(new ApiError(`HTTP ${code}`), { code });

// Models a bucket without object versioning: writing a name replaces its
// generation, so an older generation is gone, as on Google Cloud Storage.
class FakeBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly signedUrls: RecordedSignedUrl[] = [];
  afterCopy: (() => void) | undefined;
  private nextGeneration = 1000;

  put(name: string, content: Buffer | string, contentType?: string) {
    this.objects.set(name, {
      content: Buffer.from(content),
      generation: this.nextGeneration++,
      contentType,
    });
  }

  read(name: string): string | undefined {
    return this.objects.get(name)?.content.toString();
  }

  // Like the real client, a generation that is not a number is dropped, which
  // leaves the file unpinned.
  file(name: string, options: { generation?: string | number } = {}) {
    const generation = Number(options.generation);

    return new FakeFile(this, name, isNaN(generation) ? undefined : generation);
  }

  async getFiles({
    prefix = '',
    maxResults,
  }: { prefix?: string; maxResults?: number } = {}) {
    const names = [...this.objects.keys()]
      .filter((name) => name.startsWith(prefix))
      .sort()
      .slice(0, maxResults);

    return [names.map((name) => this.file(name))];
  }

  async deleteFiles({ prefix = '' }: { prefix?: string } = {}) {
    for (const name of [...this.objects.keys()]) {
      if (name.startsWith(prefix)) {
        this.objects.delete(name);
      }
    }
  }
}

class FakeFile {
  constructor(
    private readonly bucket: FakeBucket,
    readonly name: string,
    private readonly generation: number | undefined,
  ) {}

  private current(): StoredObject {
    const object = this.bucket.objects.get(this.name);

    if (
      object === undefined ||
      (this.generation !== undefined && object.generation !== this.generation)
    ) {
      throw apiError(404);
    }

    return object;
  }

  async getMetadata() {
    const object = this.current();

    return [
      {
        size: String(object.content.length),
        generation: String(object.generation),
      },
    ];
  }

  async exists() {
    try {
      this.current();

      return [true];
    } catch {
      return [false];
    }
  }

  // Like the real client, nothing is requested until the stream is read.
  createReadStream({ start, end }: { start?: number; end?: number } = {}) {
    const file = this;

    return new Readable({
      read() {
        try {
          const { content } = file.current();

          this.push(
            content.subarray(
              start ?? 0,
              end === undefined ? undefined : end + 1,
            ),
          );
          this.push(null);
        } catch (error) {
          this.destroy(error as Error);
        }
      },
    });
  }

  async download({ start = 0, end }: { start?: number; end?: number } = {}) {
    const { content } = this.current();

    if (content.length === 0) {
      throw apiError(416);
    }

    return [content.subarray(start, end === undefined ? undefined : end + 1)];
  }

  async save(data: Buffer | string, options: { contentType?: string } = {}) {
    this.bucket.put(this.name, data, options.contentType);
  }

  createWriteStream(options: { contentType?: string } = {}) {
    const chunks: Buffer[] = [];

    return new Writable({
      write: (chunk, _encoding, callback) => {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final: (callback) => {
        this.bucket.put(this.name, Buffer.concat(chunks), options.contentType);
        callback();
      },
    });
  }

  async copy(destination: string) {
    const { content, contentType } = this.current();

    this.bucket.put(destination, content, contentType);
    this.bucket.afterCopy?.();

    return [this.bucket.file(destination)];
  }

  async move(destination: string) {
    await this.copy(destination);
    await this.delete();
  }

  async delete({ ignoreNotFound = false }: { ignoreNotFound?: boolean } = {}) {
    try {
      this.current();
      this.bucket.objects.delete(this.name);
    } catch (error) {
      if (!ignoreNotFound) {
        throw error;
      }
    }
  }

  async getSignedUrl(config: Record<string, unknown>) {
    this.bucket.signedUrls.push({ name: this.name, ...config });

    return [`https://signed.example/${this.name}`];
  }
}

describe('GcsDriver', () => {
  let bucket: FakeBucket;

  const buildDriver = (options: { presignEnabled?: boolean } = {}) =>
    new GcsDriver({ bucketName: 'test-bucket', ...options });

  const readText = async (driver: GcsDriver, filePath: string) =>
    (await streamToBuffer(await driver.readFile({ filePath }))).toString();

  beforeEach(() => {
    bucket = new FakeBucket();
    jest
      .mocked(Storage)
      .mockImplementation(
        () => ({ bucket: () => bucket }) as unknown as Storage,
      );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should rely on Application Default Credentials and pass only the endpoint', () => {
    new GcsDriver({
      bucketName: 'test-bucket',
      apiEndpoint: 'http://localhost:9000',
    });

    expect(Storage).toHaveBeenCalledWith({
      apiEndpoint: 'http://localhost:9000',
    });
  });

  describe('readFile', () => {
    it('should stream the stored object', async () => {
      bucket.put('workspace/file.txt', 'hello world');

      await expect(readText(buildDriver(), 'workspace/file.txt')).resolves.toBe(
        'hello world',
      );
    });

    it('should read an inclusive byte range', async () => {
      bucket.put('workspace/file.txt', 'hello world');

      const stream = await buildDriver().readFile({
        filePath: 'workspace/file.txt',
        byteRange: { startByte: 0, endByte: 4 },
      });

      expect((await streamToBuffer(stream)).toString()).toBe('hello');
    });

    it('should reject a missing object before returning a stream', async () => {
      await expect(
        buildDriver().readFile({ filePath: 'workspace/missing.txt' }),
      ).rejects.toMatchObject({
        code: FileStorageExceptionCode.FILE_NOT_FOUND,
      });
    });
  });

  describe('readFilePrefix', () => {
    it('should return the first bytes', async () => {
      bucket.put('workspace/file.pdf', '%PDF-1.7 rest');

      const prefix = await buildDriver().readFilePrefix({
        filePath: 'workspace/file.pdf',
        byteCount: 4,
      });

      expect(prefix.toString()).toBe('%PDF');
    });

    it('should return an empty buffer for an empty object', async () => {
      bucket.put('workspace/empty.txt', '');

      const prefix = await buildDriver().readFilePrefix({
        filePath: 'workspace/empty.txt',
        byteCount: 4100,
      });

      expect(prefix.length).toBe(0);
    });

    it('should report a missing object as FILE_NOT_FOUND', async () => {
      await expect(
        buildDriver().readFilePrefix({
          filePath: 'workspace/missing.txt',
          byteCount: 4,
        }),
      ).rejects.toMatchObject({
        code: FileStorageExceptionCode.FILE_NOT_FOUND,
      });
    });
  });

  describe('writeFile and writeFileStream', () => {
    it('should store a buffer with its content type', async () => {
      await buildDriver().writeFile({
        filePath: 'workspace/file.txt',
        sourceFile: Buffer.from('content'),
        mimeType: 'text/plain',
      });

      expect(bucket.objects.get('workspace/file.txt')).toMatchObject({
        contentType: 'text/plain',
      });
      expect(bucket.read('workspace/file.txt')).toBe('content');
    });

    it('should store a streamed body', async () => {
      await buildDriver().writeFileStream({
        filePath: 'workspace/file.txt',
        stream: Readable.from([Buffer.from('streamed '), Buffer.from('body')]),
        mimeType: 'text/plain',
      });

      expect(bucket.read('workspace/file.txt')).toBe('streamed body');
    });
  });

  describe('getFileMetadata', () => {
    it('should return the size and the generation as the checksum', async () => {
      bucket.put('workspace/file.txt', 'eleven char');

      const metadata = await buildDriver().getFileMetadata({
        filePath: 'workspace/file.txt',
      });

      expect(metadata).toEqual({
        size: 11,
        checksum: String(bucket.objects.get('workspace/file.txt')?.generation),
      });
    });

    it('should return null for a missing object', async () => {
      await expect(
        buildDriver().getFileMetadata({ filePath: 'workspace/missing.txt' }),
      ).resolves.toBeNull();
    });

    it('should warn when a metadata request is slow', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const dateNowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(2500);

      bucket.put('workspace/file.txt', 'content');
      await buildDriver().getFileMetadata({ filePath: 'workspace/file.txt' });

      expect(warnSpy).toHaveBeenCalledWith(
        'GCS GetMetadata workspace/file.txt succeeded in 2500ms',
      );

      dateNowSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should not log a missing object as a failed request', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      await buildDriver().getFileMetadata({
        filePath: 'workspace/missing.txt',
      });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should report a new checksum after an overwrite', async () => {
      const driver = buildDriver();

      bucket.put('workspace/file.txt', 'one');
      const before = await driver.getFileMetadata({
        filePath: 'workspace/file.txt',
      });

      bucket.put('workspace/file.txt', 'two');
      const after = await driver.getFileMetadata({
        filePath: 'workspace/file.txt',
      });

      expect(after?.checksum).not.toBe(before?.checksum);
    });
  });

  describe('move with ifMatchChecksum', () => {
    const pending = { folderPath: 'workspace/files', filename: '.pending' };
    const final = { folderPath: 'workspace/files', filename: 'final.txt' };

    it('should promote an object that still matches the inspected generation', async () => {
      const driver = buildDriver();

      bucket.put('workspace/files/.pending', 'inspected');
      const metadata = await driver.getFileMetadata({
        filePath: 'workspace/files/.pending',
      });

      await driver.move({
        from: pending,
        to: final,
        ifMatchChecksum: metadata?.checksum,
      });

      expect(bucket.read('workspace/files/final.txt')).toBe('inspected');
      expect(bucket.objects.has('workspace/files/.pending')).toBe(false);
    });

    it('should refuse an object overwritten since it was inspected and keep the newer upload', async () => {
      const driver = buildDriver();

      bucket.put('workspace/files/.pending', 'inspected');
      const metadata = await driver.getFileMetadata({
        filePath: 'workspace/files/.pending',
      });

      bucket.put('workspace/files/.pending', 'swapped');

      await expect(
        driver.move({
          from: pending,
          to: final,
          ifMatchChecksum: metadata?.checksum,
        }),
      ).rejects.toMatchObject({
        code: FileStorageExceptionCode.PRECONDITION_FAILED,
      });
      expect(bucket.objects.has('workspace/files/final.txt')).toBe(false);
      expect(bucket.read('workspace/files/.pending')).toBe('swapped');
    });

    it('should leave an upload that lands between the copy and the delete', async () => {
      const driver = buildDriver();

      bucket.put('workspace/files/.pending', 'inspected');
      const metadata = await driver.getFileMetadata({
        filePath: 'workspace/files/.pending',
      });

      bucket.afterCopy = () => {
        bucket.afterCopy = undefined;
        bucket.put('workspace/files/.pending', 'late upload');
      };

      await driver.move({
        from: pending,
        to: final,
        ifMatchChecksum: metadata?.checksum,
      });

      expect(bucket.read('workspace/files/final.txt')).toBe('inspected');
      expect(bucket.read('workspace/files/.pending')).toBe('late upload');
    });

    it('should report a missing source as FILE_NOT_FOUND', async () => {
      await expect(
        buildDriver().move({ from: pending, to: final, ifMatchChecksum: '42' }),
      ).rejects.toMatchObject({
        code: FileStorageExceptionCode.FILE_NOT_FOUND,
      });
    });

    it('should refuse a checksum that cannot be a generation without copying', async () => {
      bucket.put('workspace/files/.pending', 'inspected');

      await expect(
        buildDriver().move({
          from: pending,
          to: final,
          ifMatchChecksum: '"an-etag"',
        }),
      ).rejects.toMatchObject({
        code: FileStorageExceptionCode.PRECONDITION_FAILED,
      });
      expect(bucket.objects.has('workspace/files/final.txt')).toBe(false);
    });
  });

  describe('move without ifMatchChecksum', () => {
    it('should report a missing source as FILE_NOT_FOUND', async () => {
      await expect(
        buildDriver().move({
          from: { folderPath: 'workspace', filename: 'missing.txt' },
          to: { folderPath: 'workspace', filename: 'moved.txt' },
        }),
      ).rejects.toMatchObject({
        code: FileStorageExceptionCode.FILE_NOT_FOUND,
      });
    });

    it('should treat a destination without a filename as a folder move', async () => {
      bucket.put('workspace/source/file.txt', 'content');

      await buildDriver().move({
        from: { folderPath: 'workspace/source', filename: 'file.txt' },
        to: { folderPath: 'workspace/target' },
      });

      expect(bucket.read('workspace/target/file.txt')).toBe('content');
      expect([...bucket.objects.keys()]).not.toContain(
        'workspace/target/undefined',
      );
    });
  });

  describe('folder operations', () => {
    beforeEach(() => {
      bucket.put('workspace/b/one.txt', '1');
      bucket.put('workspace/b/nested/two.txt', '2');
      bucket.put('workspace/bc/sibling.txt', 's');
    });

    it('should copy every object under the folder and nothing from a sibling prefix', async () => {
      await buildDriver().copy({
        from: { folderPath: 'workspace/b' },
        to: { folderPath: 'workspace/copy' },
      });

      expect(bucket.read('workspace/copy/one.txt')).toBe('1');
      expect(bucket.read('workspace/copy/nested/two.txt')).toBe('2');
      expect(bucket.objects.has('workspace/copyc/sibling.txt')).toBe(false);
    });

    it('should move every object under the folder', async () => {
      await buildDriver().move({
        from: { folderPath: 'workspace/b' },
        to: { folderPath: 'workspace/moved' },
      });

      expect(bucket.read('workspace/moved/nested/two.txt')).toBe('2');
      expect(bucket.objects.has('workspace/b/one.txt')).toBe(false);
      expect(bucket.read('workspace/bc/sibling.txt')).toBe('s');
    });

    it('should delete the folder and leave a sibling prefix', async () => {
      await buildDriver().delete({ folderPath: 'workspace/b' });

      expect(bucket.objects.has('workspace/b/one.txt')).toBe(false);
      expect(bucket.objects.has('workspace/b/nested/two.txt')).toBe(false);
      expect(bucket.read('workspace/bc/sibling.txt')).toBe('s');
    });

    it('should refuse to copy a folder onto a file name', async () => {
      await expect(
        buildDriver().copy({
          from: { folderPath: 'workspace/b' },
          to: { folderPath: 'workspace', filename: 'file.txt' },
        }),
      ).rejects.toThrow('Cannot copy folder to file');
    });

    it('should throw when moving or copying an empty folder', async () => {
      const driver = buildDriver();
      const params = {
        from: { folderPath: 'workspace/nothing' },
        to: { folderPath: 'workspace/target' },
      };

      await expect(driver.move(params)).rejects.toThrow('No objects found');
      await expect(driver.copy(params)).rejects.toThrow('No objects found');
    });

    it('should only report a folder that has objects under it', async () => {
      const driver = buildDriver();

      await expect(
        driver.checkFolderExists({ folderPath: 'workspace/b' }),
      ).resolves.toBe(true);
      await expect(
        driver.checkFolderExists({ folderPath: 'workspace/bc/sib' }),
      ).resolves.toBe(false);
    });
  });

  describe('delete and checkFileExists', () => {
    it('should delete a single object', async () => {
      bucket.put('workspace/file.txt', 'content');

      await buildDriver().delete({
        folderPath: 'workspace',
        filename: 'file.txt',
      });

      expect(bucket.objects.has('workspace/file.txt')).toBe(false);
    });

    it('should succeed when deleting a missing object', async () => {
      await expect(
        buildDriver().delete({ folderPath: 'workspace', filename: 'missing' }),
      ).resolves.toBeUndefined();
    });

    it('should report whether an object exists', async () => {
      const driver = buildDriver();

      bucket.put('workspace/file.txt', 'content');

      await expect(
        driver.checkFileExists({ filePath: 'workspace/file.txt' }),
      ).resolves.toBe(true);
      await expect(
        driver.checkFileExists({ filePath: 'workspace/missing.txt' }),
      ).resolves.toBe(false);
    });
  });

  describe('uploadFolder and downloadFolder', () => {
    const cleanupPaths: string[] = [];

    afterAll(async () => {
      await Promise.all(
        cleanupPaths.map((directoryPath) =>
          rm(directoryPath, { recursive: true, force: true }),
        ),
      );
    });

    it('should round trip a nested folder', async () => {
      const driver = buildDriver();
      const localSource = await mkdtemp(path.join(tmpdir(), 'gcs-up-'));
      const localTarget = await mkdtemp(path.join(tmpdir(), 'gcs-down-'));

      cleanupPaths.push(localSource, localTarget);
      await mkdir(path.join(localSource, 'inner'));
      await writeFile(path.join(localSource, 'root.txt'), 'root');
      await writeFile(path.join(localSource, 'inner', 'leaf.txt'), 'leaf');

      await driver.uploadFolder({
        localPath: localSource,
        onStoragePath: 'workspace/tree',
      });
      await driver.downloadFolder({
        onStoragePath: 'workspace/tree',
        localPath: localTarget,
      });

      await expect(
        readFile(path.join(localTarget, 'inner', 'leaf.txt'), 'utf8'),
      ).resolves.toBe('leaf');
      await expect(
        readFile(path.join(localTarget, 'root.txt'), 'utf8'),
      ).resolves.toBe('root');
    });
  });

  describe('signed URLs', () => {
    it('should return null when presigning is disabled', async () => {
      const driver = buildDriver();

      await expect(
        driver.getPresignedUrl({ filePath: 'workspace/file.txt' }),
      ).resolves.toBeNull();
      await expect(
        driver.getPresignedUploadUrl({
          filePath: 'workspace/file.txt',
          contentType: 'text/plain',
          contentLength: 7,
        }),
      ).resolves.toBeNull();
      expect(bucket.signedUrls).toHaveLength(0);
    });

    it('should sign a V4 read URL with the response overrides and expiry', async () => {
      const now = Date.now();

      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      const url = await buildDriver({ presignEnabled: true }).getPresignedUrl({
        filePath: 'workspace/file.txt',
        expiresInSeconds: 60,
        responseContentType: 'text/plain',
        responseContentDisposition: 'attachment; filename="file.txt"',
      });

      dateNowSpy.mockRestore();

      expect(url).toBe('https://signed.example/workspace/file.txt');
      expect(bucket.signedUrls).toEqual([
        {
          name: 'workspace/file.txt',
          version: 'v4',
          action: 'read',
          expires: now + 60_000,
          responseType: 'text/plain',
          responseDisposition: 'attachment; filename="file.txt"',
        },
      ]);
    });

    it('should bind the content type and length into a V4 upload URL', async () => {
      await buildDriver({ presignEnabled: true }).getPresignedUploadUrl({
        filePath: 'workspace/file.txt',
        contentType: 'text/plain',
        contentLength: 7,
      });

      expect(bucket.signedUrls[0]).toMatchObject({
        version: 'v4',
        action: 'write',
        contentType: 'text/plain',
        extensionHeaders: { 'content-length': 7 },
      });
    });
  });
});
