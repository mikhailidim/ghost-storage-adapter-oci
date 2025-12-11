const BaseStore = require('ghost-storage-base');
//const moment = require('moment');
const pth = require('path');
const Logger = require('@tryghost/logging').child('adapters:storage:oci');
// const crypto = require('crypto');
const ocs = require("oci-objectstorage");
const ocm = require("oci-common");
const fs = require('node:fs/promises');
const bfr = require('node:stream/consumers');
const { resolveSoa } = require('node:dns');


const stripLeadingSlash = s => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = s => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s

const buildPath = function (prefix, ...segments) {
  const suffix = segments
    .filter((segment) => typeof segment === 'string' && segment?.length >0)
    .map((segment) => segment?.replace(/^\/+|\/+$/g, ''))
    .join('/');
  return suffix.startsWith(prefix) || !prefix?.length || prefix === null
    ? suffix
    : `${prefix}/${suffix}`;
};

// Most UNIX filesystems have a 255 bytes limit for the filename length
// We keep 2 additional bytes, to make space for a file suffix (e.g. "_o" for original files after transformation)
const MAX_FILENAME_BYTES = 253;

class OciStorage extends BaseStore {
    constructor(config) {
    
        super(config);

        const {
            compartmentId,
            user,
            tenancy, 
            fingerprint,
            privateKey,
            passphrase,
            bucket,
            pathPrefix,
            assetHost,
            region,
            namespace
        } = config;
            // Compatible with the aws-sdk's default environment variables
        this.user = process.env.GHOST_STORAGE_ADAPTER_OCI_USER || user;
        this.tenancy = process.env.GHOST_STORAGE_ADAPTER_OCI_TENANCY || tenancy;
        this.fingerprint = process.env.GHOST_STORAGE_ADAPTER_OCI_FINGERPRINT || fingerprint;
        this.privateKey = process.env.GHOST_STORAGE_ADAPTER_OCI_PKEY || privateKey;
        this.passphrase = process.env.GHOST_STORAGE_ADAPTER_OCI_PASSPHRASE || passphrase;    
        this.compartmentId = process.env.GHOST_STORAGE_ADAPTER_OCI_COMPARTMENT || compartmentId;
        this.region = ocm.Region.fromRegionId( process.env.GHOST_STORAGE_ADAPTER_OCI_REGION || region);
        this.bucket = process.env.GHOST_STORAGE_ADAPTER_OCI_BUCKET || bucket;
        this.namespace = process.env.GHOST_STORAGE_ADAPTER_OCI_NAMESPACE || namespace;
        // Optional configurations
        this.host = process.env.GHOST_STORAGE_ADAPTER_OCI_HOST || assetHost || 
        `${this.namespace}.objectstorage.${this.region.regionId}.oci.customer-oci.com`;
        this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_OCI_PATH_PREFIX || pathPrefix || '');
    }

    async ocis() { 
        if (this.user && this.fingerprint && this.privateKey) {
            Logger.trace('[OCIS:build] Using config-based authentication for OCI Storage client');
            const sp = 
            new ocm.SimpleAuthenticationDetailsProvider(this.tenancy, this.user, this.fingerprint, this.privateKey, this.passphrase,this.region)
            return new ocs.ObjectStorageClient({
                        authenticationDetailsProvider: sp,
                        region: this.region,

                    })
        } else
        {
            Logger.trace('[OCIS:build] Using instance principals authentication for OCI Storage client');
          (new ocm.InstancePrincipalsAuthenticationDetailsProviderBuilder()).build().then ( rp => {
                return  new ocs.ObjectStorageClient({
                                           authenticationDetailsProvider: rp,
                            region: this.region
                     });
            });      
        }
    }
    /**
    * 
    */
    async exists(fileName, targetDir) {
        Logger.trace(`[OCIS:exists] Check existence  with parameters ${fileName} adn  ${targetDir}`);
        const targetName = buildPath(this.getTargetDir(this.pathPrefix), targetDir, fileName);
        Logger.debug(`[OCIS:exists] Checking if file exists: ${targetName} in bucket: ${this.bucket}`);
        return this.ocis().then(storage => {
            Logger.trace(`[OCIS:exists] Executing headObject for: ${targetName}`);
            storage.headObject({
                objectName: stripLeadingSlash(targetName),
                bucketName: this.bucket,
                namespaceName: this.namespace,
                retryConfiguration: {
                           retryCondition:  ocm.DefaultRetryCondition,
                           terminationStrategy: new ocm.MaxAttemptsTerminationStrategy(3)
                }
            })
            .then((result) => { 
                Logger.debug(`[OCIS:exists] File exists: ${fileName}`);
                return true;
            })
            .catch((err) => {    
                if (err.statusCode === 404) {
                    Logger.debug(`[OCIS:exists] File does not exist: ${fileName}`);
                    return false;
                } else {
                    Logger.error(`[OCIS:exists] Error checking file existence for ${fileName}:`, err);
                    throw err;
                }
            });
        });
    }    
    
    async save(image,targetDir){
        const directory = buildPath(this.getTargetDir(this.pathPrefix), targetDir);
        Logger.info(`[OCIS:save] Saving image: ${image.name} to folder: ${directory}`);
        Logger.debug(`[OCIS:save] Image details - name: ${image.name}, type: ${image.type}, size: ${image.size}`);
        Logger.trace(`[OCIS:save] Image object: ${JSON.stringify(image)}`);
        return await Promise.all([
            this.getUniqueFileName(image, directory),
            fs.readFile(image.path)
         ])
        .then( ([ fileName, file ]) => {   
            Logger.debug(`[OCIS:save] Uploading file ${fileName} to OCI bucket ${this.bucket}`);
            return this.ocis().then( storage => {
                storage.putObject({
                namespaceName: this.namespace,
                bucketName: this.bucket,
                objectName: decodeURIComponent(fileName),
                putObjectBody: file,
                contentType: image.type || 'application/octet-stream'
               })
                         })
            .then( result =>{
                const imageUrl = `https://${this.host}/n/${this.namespace}/b/${this.bucket}/o/${decodeURIComponent(fileName)}`;
                Logger.info(`[OCIS:save] Image saved successfully: ${imageUrl}`);
                return imageUrl;
            })
            .catch( err=>{
                Logger.error(`[OCIS:save] Error uploading file ${fileName}:`, err);
                throw err;
            });
        })
        .catch(err => {
            Logger.error(`[OCIS:save] Error preparing file for upload:`, err);
            throw err;
        });
        
    }

    serve(){
        return (req, res, next) => {
            Logger.debug(`[OCIS:serve] Serving file: ${req.path}`);
            this.ocis().then( storage => {
                storage.getObject({
                    bucketName: this.bucket,
                    namespaceName: this.namespace,
                    objectName: stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path),
                    retryConfiguration: {
                           retryCondition:  ocm.DefaultRetryCondition,
                           terminationStrategy: new ocm.MaxAttemptsTerminationStrategy(3)
                    }
                })
                .on('httpHeaders', (statusCode, headers, response) => {
                    Logger.debug(`[OCIS:serve] Received file with status: ${statusCode}`);
                    res.set(headers);
                })
                .value()
                .on('error', err => {
                    Logger.error(`[OCIS:serve] Error serving file ${req.path}:`, err);
                    res.status(404);
                    next(err);
                })
                .pipe(res);
             });
        }
    } 

    async delete(fileName, targetDir){   
        Logger.trace(`[OCIS:delete] Deleting file: ${fileName} from directory: ${targetDir}`);
        const targetName = buildPath(this.getTargetDir(this.pathPrefix), targetDir, fileName);
        Logger.info(`[OCIS:delete] Deleting file: ${targetName} from bucket: ${this.bucket}`);

        return await this.ocis().then( storage => {
            storage.deleteObject({
                bucketName: this.bucket,
                namespaceName: this.namespace,
                objectName: stripLeadingSlash(targetName),
            })
        })
            .then((response)=>{
                Logger.info(`[OCIS:delete] File deleted successfully: ${targetName}`);
                return true;
            })
            .catch((err) => {
                Logger.error(`[OCIS:delete] Error deleting file ${targetName}:`, err);
                return false;
            })
    }

    async read(options) {
        options = options || {path: String('')};
        Logger.debug(`[OCIS:read] Reading file with options: ${JSON.stringify(options)}`);
        // remove trailing slashes
        let urlPath = options.path.replace(/\/$|\\$/, '')
        // check if path is stored in OCI bucket handled by us
        if (urlPath.search(this.host) === -1) {
            Logger.error(`[OCIS:read] Path ${urlPath} is not stored in OCI Storage ${this.host}`);
            throw new Error(`[OCIS:read] ${urlPath} is not stored in OCI Storage ${this.host}`)
        }
        
        // Extract the object name from the URL
        const oidx = urlPath.split('/').indexOf('o'); 
        const objectName = buildPath(this.getTargetDir(this.pathPrefix), urlPath.split('/').slice(oidx + 1).join('/'));

        Logger.debug(`[OCIS:read] Retrieving object: ${objectName} from bucket: ${this.bucket}`);

        return this.ocis().then( storage => {
            return storage.getObject({
                bucketName: this.bucket,
                namespaceName: this.namespace,
                objectName: decodeURIComponent(objectName),
                retryConfiguration: {
                    retryCondition:  ocm.DefaultRetryCondition,
                    terminationStrategy: new ocm.MaxAttemptsTerminationStrategy(3)
                }
            })
            .then( (response) => {
                Logger.debug(`[OCIS:read] File read successfully: ${objectName}`);
                return bfr.buffer(response.value);
            })
            .catch((err) => {
                Logger.error(`[OCIS:read] Error reading file ${objectName}:`, err);
                throw err;
            });
                    })
    }
}

module.exports = OciStorage;
