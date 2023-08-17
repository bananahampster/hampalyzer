import * as fs from 'fs';
import * as zlib from 'zlib';
import path from 'path';
import streamPromises from 'stream/promises';
import stream from 'stream';

export class FileCompression {
    private static compressedFileExtension = ".br"; // brotli

    public static async ensureFilesCompressed(filePaths: string[], deleteOriginals: boolean): Promise<string[]> {
       return Promise.all(filePaths.map(path => this.ensurePathIsCompressed(path, deleteOriginals)));
    }

    // Returns a compressed path for the file (either already existing or newly created)
    private static async ensurePathIsCompressed(filePath: string, deleteUncompressedFile: boolean): Promise<string> {
        const filePathWithBrotliExtension = `${filePath}${FileCompression.compressedFileExtension}`;
        const shouldCompress = await this.shouldCompressFile(filePath);
        if (shouldCompress) {
            await this.compressFile(filePath, filePathWithBrotliExtension);
        }
        // Check that we can actually access the brotli file before returning that path and/or deleting the original log.
        try {
            await fs.promises.access(filePathWithBrotliExtension, fs.constants.R_OK);
            
            if (shouldCompress && deleteUncompressedFile) {
                // Double check the file round trips correctly before proceeding with removing the original.
                if (await this.verifyContentsIdentical(filePath, filePathWithBrotliExtension)) {
                    console.log(`File was compressed; deleting original file (${filePath}))`)
                    await fs.promises.unlink(filePath);
                }
            }
            return filePathWithBrotliExtension;
        }
        catch (err) {
            console.log(`Could not access ${filePathWithBrotliExtension}: ${err}`)
            return filePath;
        }
    }

    // Returns the path to compress the file to if needed, otherwise undefined.
    private static async shouldCompressFile(filePath: string): Promise<boolean> {
        if (path.extname(filePath) === FileCompression.compressedFileExtension) {
            // Already compressed.
            return false;
        }
        const filePathWithBrotliExtension = `${filePath}${FileCompression.compressedFileExtension}`;
        try {
            await fs.promises.access(filePathWithBrotliExtension, fs.constants.R_OK);
            // Brotli path already exists.
            return false;
        }
        catch (errorFromOpeningBrotliPath) {
            try {
                // Check for write access to ensure we'll be able to clean it up afterward.
                await fs.promises.access(filePath, fs.constants.R_OK | fs.constants.W_OK);
                // The path is accessible, and needs to be compressed.
                return true;
            }
            catch (error) {
                console.error(`shouldCompressFile: failed to access ${filePath}.`);
                return false;
            }
        };
    }

    private static async compressFile(filePath: string, compressedDestinationFilePath: string) {
        const inputFileSize = fs.statSync(filePath).size;

        const outputCompressedFileStream = fs.createWriteStream(compressedDestinationFilePath);

        const brotliCompressStream = zlib.createBrotliCompress({
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
              [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: inputFileSize,
            }
        });
        await streamPromises.pipeline(fs.createReadStream(filePath), brotliCompressStream, fs.createWriteStream(compressedDestinationFilePath));
    }

    public static async getDecompressedContents(filePath: string) : Promise<string> {
        let output = "";

        const pathIsCompressed = path.extname(filePath) === FileCompression.compressedFileExtension;
        console.log(`File ${filePath} (extension: ${path.extname(filePath)}) is ${!pathIsCompressed ? "not " : ""}compressed`);
        const onDiskFileStream = fs.createReadStream(filePath);
        const brotliDecompress = zlib.createBrotliDecompress();
        let streamToListenTo: stream.Readable = pathIsCompressed ? brotliDecompress : onDiskFileStream;

        const chunks: Uint8Array[] = [];
        streamToListenTo.on(
            "data", (chunk) => { chunks.push(Buffer.from(chunk)) }).on(
            "error", (err) => { console.log(`Failed to read ${filePath}`)}).on(
            `${pathIsCompressed ? "finish" : "end"}`, () => { output = Buffer.concat(chunks).toString('utf8'); });

        if (pathIsCompressed) {
            await streamPromises.pipeline(onDiskFileStream, brotliDecompress);
        }
        else {
            await streamPromises.finished(onDiskFileStream);
        }
        return output;
    }

    public static async verifyContentsIdentical(uncompressedFilePath: string, compressedFilePath: string) : Promise<boolean> {
        const uncompressedFileContents = await this.getDecompressedContents(uncompressedFilePath);
        if (uncompressedFileContents.length < 100) {
            // Extra paranoia: confirm the uncompressed file is reasonably large before proceeding.
            console.error(`verifyContentsIdentical: uncompressed file (${uncompressedFilePath}) smaller than expected (length=${uncompressedFileContents.length})`;
            return false;
        }
        const compressedFileContents = await this.getDecompressedContents(compressedFilePath);

        if (uncompressedFileContents != compressedFileContents) {
            console.error(`verifyContentsIdentical: uncompressed file (${uncompressedFilePath}, length=${uncompressedFileContents.length}) contents different than compressed file (${compressedFileContents}, length=${uncompressedFileContents.length})`);
            return false;
        }
        return true;
    }
}
