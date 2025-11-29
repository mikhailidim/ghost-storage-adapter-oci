const BaseStore = require('ghost-storage-base');
//const moment = require('moment');
const pth = require('path');
const Logger = require('@tryghost/logging').child('adapters:storage:oci');
// const crypto = require('crypto');
const ocs = require("oci-objectstorage");
const ocm = require("oci-common");
const fs = require('node:fs/promises');
const bfr = require('node:stream/consumers');


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
        Logger.info('Initializing OCI Storage adapter');

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
        Logger.info(`OCI Storage adapter initialized - bucket: ${this.bucket}, namespace: ${this.namespace}, region: ${this.region.regionId}`);

    }
    ocis(){ 
        // const provider = new ocm.ConfigFileAuthenticationDetailsProvider(this.configPath,this.profileName);    
        const cfg = {"tenancy": this.tenancy, "user": this.user, "fingerprint": this.fingerprint, 
            "privateKey": this.privateKey, "passphrase": null, "region": ocm.Region.US_ASHBURN_1};
        const provider = new ocm.SimpleAuthenticationDetailsProvider(this.tenancy, this.user, this.fingerprint, this.privateKey, this.passphrase,this.region);
        return    new ocs.ObjectStorageClient({
                            authenticationDetailsProvider: provider
                    });  
    }

    /**
    * 
    */
    exists(fileName, targetDir) {
        const targetName = buildPath(this.pathPrefix, targetDir, fileName);
        Logger.debug(`Checking if file exists: /${targetName} in bucket: ${this.bucket}`);
        return new Promise((resolve, reject) => {
        this.ocis()
        .headObject({
            objectName: stripLeadingSlash(targetName),
            bucketName: this.bucket,
            namespaceName: this.namespace,
            retryStrategy: ocm.NoneRetryStrategy
        }).then((result) => { 
            Logger.debug(`File exists: ${fileName}`);
            resolve(true);
        }).catch((err) => {    
            if (err.statusCode === 404) {
                Logger.debug(`File does not exist: ${fileName}`);
                resolve(false);
            } else {
                Logger.error(`Error checking file existence for ${fileName}:`, err);
                reject(err);
            }
        });
    //    throw new Error('Not implemented');
        });
    }
    
    save(image,targetDir){
        const directory = buildPath(this.pathPrefix, targetDir);
        Logger.info(`Saving image: ${image.name} to folder: ${directory}`);
        Logger.debug(`Image details - name: ${image.name}, type: ${image.type}, size: ${image.size}`);
        Logger.trace(`Image object: ${JSON.stringify(image)}`);
        return new Promise((resolve, reject) => {
            Promise.all([
                this.getUniqueFileName(image, directory),
                fs.readFile(image.path)
            ])
            .then(([ fileName, file ]) => {   
                Logger.debug(`Uploading file ${fileName} to OCI bucket ${this.bucket}`);
                this.ocis()
                .putObject({
                    namespaceName: this.namespace,
                    bucketName: this.bucket,
                    objectName: decodeURIComponent(fileName),
                    putObjectBody: file,
                    contentType: image.type || 'application/octet-stream'
                }).then( (result)=>{
                        const imageUrl = `https://${this.host}/n/${this.namespace}/b/${this.bucket}/o/${decodeURIComponent(fileName)}`;
                        Logger.info(`Image saved successfully: ${imageUrl}`);
                        resolve(imageUrl);
                }).catch( err=>{
                        Logger.error(`Error uploading file ${fileName}:`, err);
                        reject(err);
                });
            }).catch(err => {
                Logger.error(`Error preparing file for upload:`, err);
                reject(err);
            });
        });
    }

    serve(){
        return (req, res, next) => {
            Logger.debug(`Serving file: ${req.path}`);
            this.ocis()
                .getObject({
                bucketName: this.bucket,
                namespaceName: this.namespace,
                objectName: stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path)
                })
                .on('httpHeaders', (statusCode, headers, response) => {
                    Logger.debug(`Received file with status: ${statusCode}`);
                    res.set(headers);
                })
                .value()
                .on('error', err => {
                    Logger.error(`Error serving file ${req.path}:`, err);
                    res.status(404);
                    next(err);
                })
                .pipe(res);
        }
    } 

    delete(fileName, targetDir){   
        const targetName = buildPath(this.pathPrefix, targetDir, fileName);
        Logger.info(`Deleting file: ${targetName} from bucket: ${this.bucket}`);

        return new Promise((resolve, reject) => {
            this.ocis()
                .deleteObject({
                bucketName: this.bucket,
                namespaceName: this.namespace,
                objectName: stripLeadingSlash(targetName),
                retryStrategy: ocm.NoneRetryStrategy
                }).then((response)=>{
                    Logger.info(`File deleted successfully: ${targetName}`);
                    resolve(true);
                }).catch((err) => {
                    Logger.warn(`Error deleting file ${targetName}:`, err);
                    resolve(false);
                })
        })
    }
    read(options) {
        options = options || {path: String('')};
        Logger.debug(`Reading file with options: ${JSON.stringify(options)}`);

        return new Promise((resolve, reject) => {
        // remove trailing slashes
        let urlPath = options.path.replace(/\/$|\\$/, '')

        // check if path is stored in OCI bucket handled by us
        if (urlPath.search(this.host) === -1) {
            Logger.error(`Path ${urlPath} is not stored in OCI Storage ${this.host}`);
            reject(new Error(`${urlPath} is not stored in OCI Storage ${this.host}`))
            return;
        }
        
        // Extract the object name from the URL
        const oidx = urlPath.split('/').indexOf('o'); 
        const objectName = buildPath(this.pathPrefix, urlPath.split('/').slice(oidx + 1).join('/'));

        Logger.debug(`Retrieving object: ${objectName} from bucket: ${this.bucket}`);

        this.ocis()
            .getObject({
            bucketName: this.bucket,
            namespaceName: this.namespace,
            objectName: decodeURIComponent(objectName)
            }).then( (response) => {
                Logger.debug(`File read successfully: ${objectName}`);
                resolve(bfr.buffer(response.value));
            }).catch((err) => {
                Logger.error(`Error reading file ${objectName}:`, err);
                reject(err);
            });
        });
    }
}

module.exports = OciStorage;
