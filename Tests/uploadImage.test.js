// uploadImage.test.js

const fs = require('fs');
const path = require('path');
const { uploadImage } = require('../utils/imageUpload'); // Replace with the correct path to your uploadImage module
const AWSMock = require('aws-sdk-mock');
const { S3Client } = require("@aws-sdk/client-s3");

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid')
}));

jest.mock('@aws-sdk/client-s3');

describe('uploadImage', () => {
  let consoleErrorSpy;
  let base64Image;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Read the image file and convert it to base64
    const imagePath = path.join(__dirname, 'testConfigs', 'testImage.jpg');
    const imageBuffer = fs.readFileSync(imagePath);
    base64Image = Buffer.from(imageBuffer).toString('base64');
  });

  beforeEach(() => {
    S3Client.prototype.send.mockResolvedValue({});
    process.env.IMAGES_BUCKET_NAME = 'uom-fit-ams-images-bucket'; // Replace with your bucket name

  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockClear();
    delete process.env.IMAGES_BUCKET_NAME; // Clear the IMAGES_BUCKET_NAME

  });


  

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should upload an image to S3 and return the image URL', async () => {
    const imageDataUri = `data:image/jpeg;base64,${base64Image}`;
    const expectedImageUrl = `https://${process.env.IMAGES_BUCKET_NAME}.s3.amazonaws.com/mocked-uuid.jpg`;

    const result = await uploadImage(imageDataUri);

    expect(result.imageUrl).toEqual(expectedImageUrl);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
  it('should handle errors during image upload', async () => {
    const imageDataUri = `data:image/jpeg;base64,${base64Image}`;

    S3Client.prototype.send.mockRejectedValue(new Error('Upload failed'));

    await expect(uploadImage(imageDataUri)).rejects.toThrowError('Error uploading image');
  });
});
