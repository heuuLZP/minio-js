/*
 * Minio Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015, 2016 Minio, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as xmlParsers from './xml-parsers.js'
import * as _ from 'lodash'
import Through2 from 'through2'
import Crypto from 'crypto';

import { isFunction } from './helpers.js'
import * as errors from './errors.js'

// getConcater returns a stream that concatenates the input and emits
// the concatenated output when 'end' has reached. If an optional
// parser function is passed upon reaching the 'end' of the stream,
// `parser(concatenated_data)` will be emitted.
export function getConcater(parser, emitError) {
  var objectMode = false
  var bufs = []

  if (parser && !isFunction(parser)) {
    throw new TypeError('parser should be of type "function"')
  }

  if (parser) {
    objectMode = true
  }

  return Through2({objectMode},
  function (chunk, enc, cb) {
    bufs.push(chunk)
    cb()
  }, function (cb) {
    if (emitError) {
      cb(parser(Buffer.concat(bufs).toString()))
      // cb(e) would mean we have to emit 'end' by explicitly calling this.push(null)
      this.push(null)
      return
    }
    if (bufs.length) {
      if (parser) {
        this.push(parser(Buffer.concat(bufs).toString()))
      } else {
        this.push(Buffer.concat(bufs))
      }
    }
    cb()
  })
}

// Generates an Error object depending on http statusCode and XML body
export function getErrorTransformer(response) {
  var statusCode = response.statusCode
  var code, message
  if (statusCode === 301) {
    code = 'MovedPermanently'
    message = 'Moved Permanently'
  } else if (statusCode === 307) {
    code = 'TemporaryRedirect'
    message = 'Are you using the correct endpoint URL?'
  } else if (statusCode === 403) {
    code = 'AccessDenied'
    message = 'Valid and authorized credentials required'
  } else if (statusCode === 404) {
    code = 'NotFound'
    message = 'Not Found'
  } else if (statusCode === 405) {
    code = 'MethodNotAllowed'
    message = 'Method Not Allowed'
  } else if (statusCode === 501) {
    code = 'MethodNotAllowed'
    message = 'Method Not Allowed'
  } else {
    code = 'UnknownError'
    message = `${statusCode}`
  }

  var headerInfo = {}
  // A value created by S3 compatible server that uniquely identifies
  // the request.
  headerInfo.amzRequestid = response.headersSent ? response.getHeader('x-amz-request-id') : null
  // A special token that helps troubleshoot API replies and issues.
  headerInfo.amzId2 = response.headersSent ? response.getHeader('x-amz-id-2') : null
  // Region where the bucket is located. This header is returned only
  // in HEAD bucket and ListObjects response.
  headerInfo.amzBucketRegion = response.headersSent ? response.getHeader('x-amz-bucket-region') : null

  return getConcater(xmlString => {
    if (!xmlString) {
      // Message should be instantiated for each S3Errors.
      var e = new errors.S3Error(message)
      // S3 Error code.
      e.code = code
      _.each(headerInfo, (value, key) => {
        e[key] = value
      })
      return e
    }
    return xmlParsers.parseError(xmlString, headerInfo)
  }, true)
}

// Makes sure that only size number of bytes go through this stream
export function getSizeLimiter(size, stream, chunker) {
  var sizeRemaining = size
  return Through2.obj(function(chunk, enc, cb) {
    var length = Math.min(chunk.length, sizeRemaining)
    // We should read only till 'size'
    if (length < chunk.length) chunk = chunk.slice(0, length)
    this.push(chunk)
    sizeRemaining -= length
    if (sizeRemaining === 0) {
      // Unpipe so that the streams do not send us more data
      stream.unpipe()
      chunker.unpipe()
      this.push(null)
    }
    cb()
  }, function(cb) {
    if (sizeRemaining !== 0) {
      return cb(new errors.IncorrectSizeError(`size of the input stream is not equal to the expected size(${size})`))
    }
    this.push(null)
    cb()
  })
}

// A through stream that calculates md5sum and sha256sum
export function getHashSummer(anonymous) {
  var md5 = Crypto.createHash('md5')
  var sha256 = Crypto.createHash('sha256')

  return Through2.obj(function(chunk, enc, cb) {
    md5.update(chunk)
    if (!anonymous) sha256.update(chunk)
    cb()
  }, function(cb) {
    var md5sum = md5.digest('base64')
    var hashData = {md5sum}
    if (!anonymous) hashData.sha256sum = sha256.digest('hex')
    this.push(hashData)
    this.push(null)
  })
}

// Following functions return a stream object that parses XML
// and emits suitable Javascript objects.

// Parses listBuckets response.
export function getListBucketTransformer() {
  return getConcater(xmlParsers.parseListBucket)
}

// Parses listMultipartUploads response.
export function getListMultipartTransformer() {
  return getConcater(xmlParsers.parseListMultipart)
}

// Parses listParts response.
export function getListPartsTransformer() {
  return getConcater(xmlParsers.parseListParts)
}

// Parses getBucketACL response.
export function getAclTransformer() {
  return getConcater(xmlParsers.parseAcl)
}

// Parses initMultipartUpload response.
export function getInitiateMultipartTransformer() {
  return getConcater(xmlParsers.parseInitiateMultipart)
}

// Parses listObjects response.
export function getListObjectsTransformer() {
  return getConcater(xmlParsers.parseListObjects)
}

// Parses completeMultipartUpload response.
export function getCompleteMultipartTransformer() {
  return getConcater(xmlParsers.parseCompleteMultipart)
}

// Parses getBucketLocation response.
export function getBucketRegionTransformer() {
  return getConcater(xmlParsers.parseBucketRegion)
}