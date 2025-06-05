const BaseStore = require('ghost-storage-base');
//const moment = require('moment');
const pth = require('path');

// const crypto = require('crypto');
const ocs = require("oci-objectstorage");
const ocommon = require("oci-common");
const fs = require('node:fs/promises');
const bfr = require('node:stream/consumers');


const stripLeadingSlash = s => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = s => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s

// Most UNIX filesystems have a 255 bytes limit for the filename length
// We keep 2 additional bytes, to make space for a file suffix (e.g. "_o" for original files after transformation)
const MAX_FILENAME_BYTES = 253;

class OciStorage extends BaseStore {
    constructor(config) {
        super(config);

        const {
            compartmentId,
            profileName,
            configPath,
            bucket,
            pathPrefix,
            assetHost,
            region,
            namespace
        } = config;
            // Compatible with the aws-sdk's default environment variables
        this.compartmentId = process.env.GHOST_STORAGE_ADAPTER_OCI_COMPARTMENT || compartmentId;
        this.region = process.env.GHOST_STORAGE_ADAPTER_OCI_REGION || region;
        this.bucket = process.env.GHOST_STORAGE_ADAPTER_OCI_BUCKET || bucket;
        this.namespace = process.env.GHOST_STORAGE_ADAPTER_OCI_NAMESPACE || namespace;
        // Optional configurations
        this.host = process.env.GHOST_STORAGE_ADAPTER_OCI_HOST || assetHost || 
        `${this.namespace}.objectstorage.${this.region}.oci.customer-oci.com`;
        this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_OCI_PATH_PREFIX || pathPrefix || '');
        this.profileName = process.env.GHOST_STORAGE_ADAPTER_OCI_PROFILE || profileName  || 'DEFAULT';
        this.configPath  = process.env.GHOST_STORAGE_ADAPTER_OCI_CONFIG || configPath || '~/.oci/config';

    }
    ocis(){ 
        const provider = new ocommon.ConfigFileAuthenticationDetailsProvider(this.configPath,this.profileName);    
        return    new ocs.ObjectStorageClient({
                            authenticationDetailsProvider: provider
                    });  
    }

    /**
    * 
    */
    exists(fileName, targetDir) {
        return new Promise((resolve, reject) => {
        this.ocis()
        .headObject({
            objectName: stripLeadingSlash(pth.join(targetDir, fileName)),
            bucketName: this.bucket,
            namespaceName: this.namespace
        }).then((result) => { 
            resolve(true);
        }).catch((err) => {    
            if (err.statusCode === 404) {
                resolve(false);
            } else {
                console.error('>> Error checking file existence:', err);
                reject(err);
            }
        });
    //    throw new Error('Not implemented');
        });
    }
    
    save(image,targetDir){
        const directory = targetDir || this.getTargetDir(this.pathPrefix);
        return new Promise((resolve, reject) => {
            Promise.all([
                this.getUniqueFileName(image, directory),
                fs.readFile(image.name)
            ])
            .then(([ fileName, file ]) => {   
                this.ocis()
                .putObject({
                    namespaceName: this.namespace,
                    bucketName: this.bucket,
                    objectName: fileName,
                    putObjectBody: file,
                    contentType: image.type || 'application/octet-stream'
                }).then( (result)=>{
                        resolve(`//${this.host}/n/${this.namespace}/b/${this.bucket}/o/${encodeURIComponent(fileName)}`);
                }).catch( err=>{
                        reject(err);
                });
            });
        });
    }

    serve(){
        return (req, res, next) =>
            this.ocis()
                .getObject({
                bucketName: this.bucket,
                namespaceName: this.namespace,
                objectName: stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path)
                })
                .on('httpHeaders', (statusCode, headers, response) => res.set(headers))
                .value()
                .on('error', err => {
                res.status(404)
                next(err)
                })
                .pipe(res)
    } 

    delete(fileName, targetDir){   
        const directory = targetDir || this.getTargetDir(this.pathPrefix)

        return new Promise((resolve, reject) => {
            this.ocis()
                .deleteObject({
                bucketName: this.bucket,
                namespaceName: this.namespace,
                objectName: stripLeadingSlash(pth.join(directory, fileName))
                }).then((response)=>{
                    resolve(true);
                }).catch((err) => {
                    resolve(false);
                })
        })
    }
    read(options) {
        options = options || {path: String('')};

        return new Promise((resolve, reject) => {
        // remove trailing slashes
        let path = options.path.replace(/\/$|\\$/, '')

        // check if path is stored in s3 handled by us
        if (path.search(this.host) === -1) {
            reject(new Error(`${path} is not stored in Stored in OCI Storage ${this.host}`))
        }
        path = decodeURIComponent(pth.basename(path));

        this.ocis()
            .getObject({
            bucketName: this.bucket,
            namespaceName: this.namespace,
            objectName: stripLeadingSlash(path)
            }).then( (response) => {
                resolve(bfr.buffer(response.value));
            }).catch((err) => {
                console.error('>> Error reading file:', err);
                reject(err);
            });
        });
    }
}

module.exports = OciStorage;
