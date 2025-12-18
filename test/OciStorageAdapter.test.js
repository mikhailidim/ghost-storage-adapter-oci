const assert = require('assert').strict;
const pth = require('path');
const fs = require("fs");
require('dotenv').config({ path: pth.join(__dirname, '..', '.env') });
const StorageBase = require('../OciStorage');
const { Console, clear } = require('console');
const MAX_FILENAME_BYTES = 253;

const cfg ={

    tenancy: process.env.GHOST_STORAGE_ADAPTER_OCI_TENANCY || tenancy,
//    user: process.env.GHOST_STORAGE_ADAPTER_OCI_USER || user,
//    fingerprint: process.env.GHOST_STORAGE_ADAPTER_OCI_FINGERPRINT || fingerprint,
//    privateKey: process.env.GHOST_STORAGE_ADAPTER_OCI_PKEY || privateKey,
//    passphrase: process.env.GHOST_STORAGE_ADAPTER_OCI_PASSPHRASE || null,   
    compartmentId: process.env.GHOST_STORAGE_ADAPTER_OCI_COMPARTMENT || compartmentId,
    region: process.env.GHOST_STORAGE_ADAPTER_OCI_REGION || 'us-ashburn-1',
    bucket: process.env.GHOST_STORAGE_ADAPTER_OCI_BUCKET || bucket,
    namespace: process.env.GHOST_STORAGE_ADAPTER_OCI_NAMESPACE || namespace,
        // Optional configurations
    // Optional configurations
    host: process.env.GHOST_STORAGE_ADAPTER_OCI_HOST || 
        `${this.namespace}.objectstorage.${this.region}.oci.customer-oci.com`,
    // Test path prefix
    pathPrefix: process.env.GHOST_STORAGE_ADAPTER_OCI_PATH_PREFIX || 'test-images',
};

describe('Storage Adapter Access', async function () {
  describe('Basic Storage Client Properties', async function () {
    it('should have a valid namespace', async function () {
        const client = new StorageBase(cfg)
        client.ocis()
        .then( storage=>{
            let request = {};
            storage.getNamespace(request)
            .then(response => {
                assert.equal(response.value, cfg.namespace, 'Namespace is not set');
            })
            .catch(err => {
                    assert.fail(`Namespace retrieval failed with error: ${err.message}`);
            });
        });
    });
    it('should have a valid bucket name', async function () {
        const client =  new StorageBase(cfg);
        client.ocis()
        .then( storage=> {
            const request = {
                bucketName: cfg.bucket,
                namespaceName: cfg.namespace
            }    
         return storage.getBucket(request)
            .then(response => {
                    assert.equal(response.bucket.name, cfg.bucket, 'Bucket name does not match');
            })
            .catch(err => {
                    assert.fail(`Bucket retrieval failed with error: ${err.message}`);
            });
        });
    });
  });
  describe('Storage Adapter Functions',  async function () {
    let testImage;
    before( function() {
        testImage = {
                name: 'test-image.webp',
                type: 'image/webp',
                path: 'test/test-image.webp',
        }
    });
    it('Uploads file to the OCI bucket',  async function () {
        const adapter = new StorageBase(cfg);
        return adapter.save(testImage, 'save-test')
            .then((result) => {
                testImage['storedAs'] = result;
                assert.ok(testImage.storedAs, 'File upload failed');
            })
            .catch(err => {
                assert.fail(`File upload failed with error: ${err.message}`);
            });
    });
            
    it("Should return the resulting object path", async function () {
            assert.ok(testImage.storedAs, 'Object name was not recorded.');
    });

    it('should read the file from the bucket', async function () {
        const adapter = new StorageBase(cfg);
        return adapter.read({path: String(testImage.storedAs)})
            .then((result) => {
                fs.readFile(testImage.path, (err, data) => {
                    if (err) {
                        assert.fail(`Can't read image file: ${err}`);
                    } else {
                        assert.equal(result.length, data.length,'Imaage file and object are different');
                    }
                });
            })
            .catch(err => {
                assert.fail(`Object read failed with error: ${err.message}`);
            });
        });

    it('should delete the file from the bucket', async function () {
        const adapter = new StorageBase(cfg);
        if (process.env.KEEP_FILES) 
            this.skip()
        else
            return adapter.delete(pth.basename(testImage.name), 'save-test')
            .then((result) => {
                assert.ok(result, 'File deletion failed');
            }).catch(err => {
                assert.fail(`File deletion failed with error: ${err.message}`);
        });
    });
    });
});
