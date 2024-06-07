const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const { S3Client } = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const s3Client = new S3Client();
const errors = require('../config/errors');
const { config } = require("dotenv");

const IMAGES_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME || config().parsed.IMAGES_BUCKET_NAME;

async function uploadImage(imageDataUri) {
  try {
    // Extract base64-encoded image data from the data URL
    const base64Image = imageDataUri.split(',')[1];

    // Decode base64 string to Buffer
    const decodedImage = Buffer.from(base64Image, 'base64');

    // Compress the image using sharp
    const compressedImage = await sharp(decodedImage)
      .resize({ width: 800 }) // Resize the image to a width of 800px (optional)
      .jpeg({ quality: 80 }) // Compress the image with 80% quality
      .toBuffer();

    const imageId = uuidv4();

    const uploadParams = {
      Bucket: IMAGES_BUCKET_NAME,
      Key: `${imageId}.jpg`,
      Body: compressedImage,
      ContentType: "image/jpg",
      ACL: "public-read",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const imageUrl = `https://${IMAGES_BUCKET_NAME}.s3.amazonaws.com/${imageId}.jpg`;
    return { imageUrl };
  } catch (error) {
    console.error("Error:", error);
    throw new Error(errors.imageUploadError);
  }
}

module.exports = { uploadImage };
