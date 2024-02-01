
const {PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const { S3Client } = require("@aws-sdk/client-s3");
const IMAGES_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const s3Client = new S3Client();


async function uploadImage(imageDataUri) {
    try {
      // Extract base64-encoded image data from the data URL
      const base64Image = imageDataUri.split(',')[1];
  
      // Decode base64 string to Buffer
      const decodedImage = Buffer.from(base64Image, 'base64');
  
      const imageId = uuidv4();
  
      const uploadParams = {
        Bucket: IMAGES_BUCKET_NAME,
        Key: `${imageId}.jpg`,
        Body: decodedImage,
        ContentType: "image/jpg",
        ACL: "public-read",
      };
  
     
  
      await s3Client.send(new PutObjectCommand(uploadParams));
  
      const imageUrl = `https://${IMAGES_BUCKET_NAME}.s3.amazonaws.com/${imageId}.jpg`;
      return { imageUrl };
    } catch (error) {
      console.error("Error:", error);
      throw new Error("Image upload failed");
    }
  }

    module.exports = { uploadImage };