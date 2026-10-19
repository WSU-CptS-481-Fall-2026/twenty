import { renderHook } from '@testing-library/react';
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock';

import { useDirectFileUpload } from '@/file/hooks/useDirectFileUpload';
import {
  CreateFileUploadDocument,
  FileFolder,
} from '~/generated-metadata/graphql';

const mockCreateFileUpload = jest.fn();
const mockCompleteFileUpload = jest.fn();

jest.mock('@apollo/client/react', () => ({
  useApolloClient: jest.fn(),
  useMutation: (document: unknown) => [
    document === CreateFileUploadDocument
      ? mockCreateFileUpload
      : mockCompleteFileUpload,
  ],
}));

const originalFetch = globalThis.fetch;
const file = new File(['upload content'], 'test.txt', { type: 'text/plain' });
const uploadedFile = {
  id: 'file-id',
  path: 'test.txt',
  size: file.size,
  createdAt: '2026-10-18T00:00:00.000Z',
  url: 'https://storage.example/test.txt',
};

describe('useDirectFileUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enableFetchMocks();
    fetchMock.resetMocks();
    fetchMock.mockResponse('');
    mockCreateFileUpload.mockResolvedValue({
      data: {
        createFileUpload: {
          fileId: 'file-id',
          uploadUrl: '/file-upload/file-id?token=upload-token',
          contentType: 'application/octet-stream',
        },
      },
    });
    mockCompleteFileUpload.mockResolvedValue({
      data: { completeFileUpload: uploadedFile },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    '/file-upload/file-id?token=upload-token',
    'https://storage.example/test.txt?signature=presigned',
  ])(
    'uploads to %s with only same-origin credentials and finalizes',
    async (uploadUrl) => {
      mockCreateFileUpload.mockResolvedValue({
        data: {
          createFileUpload: {
            fileId: 'file-id',
            uploadUrl,
            contentType: 'application/octet-stream',
          },
        },
      });
      const signal = new AbortController().signal;
      const { result } = renderHook(() => useDirectFileUpload());

      await expect(
        result.current.uploadFile(file, {
          fileFolder: FileFolder.FilesField,
          fieldMetadataId: 'field-id',
          signal,
        }),
      ).resolves.toEqual(uploadedFile);

      expect(mockCreateFileUpload).toHaveBeenCalledWith({
        variables: {
          filename: file.name,
          size: file.size,
          fileFolder: FileFolder.FilesField,
          fieldMetadataId: 'field-id',
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        credentials: 'same-origin',
        signal,
      });
      expect(mockCompleteFileUpload).toHaveBeenCalledWith({
        variables: { fileId: 'file-id' },
      });
    },
  );

  it('propagates HTTP failures without finalizing the upload', async () => {
    fetchMock.mockResponse('', { status: 401 });
    const { result } = renderHook(() => useDirectFileUpload());

    await expect(
      result.current.uploadFile(file, { fileFolder: FileFolder.FilesField }),
    ).rejects.toThrow('File upload failed with status 401');
    expect(mockCompleteFileUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['cancellation', new DOMException('Upload aborted', 'AbortError')],
    ['network failure', new TypeError('Failed to fetch')],
  ])('propagates %s without finalizing the upload', async (_name, error) => {
    fetchMock.mockRejectedValue(error);
    const { result } = renderHook(() => useDirectFileUpload());

    await expect(
      result.current.uploadFile(file, { fileFolder: FileFolder.FilesField }),
    ).rejects.toBe(error);
    expect(mockCompleteFileUpload).not.toHaveBeenCalled();
  });
});
