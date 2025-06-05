const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const StorageBase = require('../OciStorage');

const cfg ={
    comaprtemntId: process.env.OCI_COMPARTMENT_ID || process.env.comaprtemntId, 
    region: process.env.OCI_REGION || process.env.region, 
    namespace: process.env.OCI_NAMESPACE || process.env.namespace, 
    bucket: process.env.OCI_BUCKET_NAME || process.env.bucket,
//    configPath: process.env.OCI_CONFIG_PATH || process.env.configPath || '~/.oci/config',         
//    profileName: process.env.OCI_PROFILE_NAME || process.env.profileName || 'DEFAULT',
    pathPrefix: process.env.OCI_PATH_PREFIX || process.env.pathPrefix || ''
};
console.log('Entry point');
const testImage = {
                name: './test-image.webp',
                type: 'image/webp',
            }
const adapter = new StorageBase(cfg);
console.log('Adapter created');

adapter.save(testImage, 'save-test').then((result) => {
    console.log('File uploaded successfully:', result);
}).catch((err) => {
    console.error('Error uploading file:', err);
});

// adapter.exists(path.basename(testImage.name), 'save-test').then((result) => {
// console.log(result);
// }).catch((err) => {
//     console.error('Error checking file existence:', err);
// });
