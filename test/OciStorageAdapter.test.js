const assert = require('assert').strict;
const pth = require('path');
const fs = require("fs");
require('dotenv').config({ path: pth.join(__dirname, '..', '.env') });
const StorageBase = require('../OciStorage');
const MAX_FILENAME_BYTES = 253;

const cfg ={
    comaprtemntId: process.env.OCI_COMPARTMENT_ID || process.env.comaprtemntId, 
    region: process.env.OCI_REGION || process.env.region, 
    namespace: process.env.OCI_NAMESPACE || process.env.namespace, 
    bucket: process.env.OCI_BUCKET_NAME || process.env.bucket,
    host: process.env.OCI_HOST || process.env.host||'', 
    configPath: process.env.OCI_CONFIG_PATH || process.env.configPath || '~/.oci/config',         
    profileName: process.env.OCI_PROFILE_NAME || process.env.profileName || 'DEFAULT',
    pathPrefix: process.env.OCI_PATH_PREFIX || process.env.pathPrefix || ''
};

describe('Storage Adapter Access', function () {
    describe('Basic Storage Client Properties', function () {
        it('should have a valid namespace', async function () {
            const storage = new StorageBase(cfg).ocis();
            request = {};
            await storage.getNamespace(request).then(response => {
                assert.equal(response.value, cfg.namespace, 'Namespace is not set');
            }
            ).catch(err => {
                assert.fail(`Namespace retrieval failed with error: ${err.message}`);
            });
        });
        it('should have a valid bucket name', async function () {
            const storage = new StorageBase(cfg).ocis();
            const request = {
                bucketName: cfg.bucket,
                namespaceName: cfg.namespace
            }    
            return storage.getBucket(request).then(response => {
                assert.equal(response.bucket.name, cfg.bucket, 'Bucket name does not match');
            }
            ).catch(err => {
                assert.fail(`Bucket retrieval failed with error: ${err.message}`);
            });
        });
    });

    describe('Storage Adapter Functions', function () {
        var testImage;
        const adapter = new StorageBase(cfg);
        before( function(done) {
            testImage = {
                name: 'test/test-image.webp',
                type: 'image/webp',
            }
            done();     
        });
        it('Uploads file to the OCI bucket', async function () {
            return adapter.save(testImage, 'save-test').then((result) => {
                testImage['storedAs'] = result;
                assert.ok(testImage.storedAs, 'File upload failed');
            }).catch(err => {
                assert.fail(`File upload failed with error: ${err.message}`);
            });
        });
            
        it("Should return the resulting object path", function (done) {
            assert.ok(testImage.storedAs, 'Object name was not recorded.');
            done();
        });

        it('should read the file from the bucket', async function () {
            return adapter.read({path: String(testImage.storedAs)}).then((result) => {
                fs.readFile(testImage.name, (err, data) => {
                    if (err) {
                        assert.fail(`Can't read image file: ${err}`);
                    } else {
                        assert.equal(result.length, data.length,'Imaage file and object are different');
                    }
                });
            }).catch(err => {
                assert.fail(`Object read failed with error: ${err.message}`);
            });
        });

        it('should delete the file from the bucket', async function () {
            return adapter.delete(pth.basename(testImage.name), 'save-test').then((result) => {
                assert.ok(result, 'File deletion failed');
            }).catch(err => {
                assert.fail(`File deletion failed with error: ${err.message}`);
            });
        });
    });
});
