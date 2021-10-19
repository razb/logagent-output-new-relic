'use strict'
const request = require('requestretry')
const zlib = require('zlib');
/** example configuration
  output:
    module: logagent-output-new-relic
    url: https://log-api.newrelic.com/log/v1
    licenseKey: XXXXXXXXXXXXXXXXXXXXXXXXXX
    maxBufferSize: 1
    flushInterval: 1
    tags:
      host: myServerName
    filter:
      field: logSource
      match: hostname.*
*/
function OutputNewrelic(config, eventEmitter) {
    this.config = config
    this.buffer = []
    this.eventEmitter = eventEmitter
    if (this.config.filters && this.config.filters.length > 0) {
        this.config.filters.map(filtergroup => {
            if (filtergroup[0]) {
                filtergroup.map(filter => {
                    if (
                        filter &&
                        filter.match &&
                        filter.field
                    ) {
                        filter.match = RegExp(filter.match)
                    }
                })
            }
        })
    }
    if (this.config.maxBufferSize === undefined) {
        // set default
        this.config.maxBufferSize = 1
    }
    if (this.config.maxBufferSize <= 0) {
        // set default to 100, when buffer size is set to 0 or negative values
        this.config.maxBufferSize = 100
    }
    if (!this.config.flushInterval) {
        // set default 10 seconds
        this.config.flushInterval = 10
    }
    if (this.config.flushInterval < 0.5) {
        // don't allow more than 2 requests per second
        this.config.flushInterval = 1
    }

}
module.exports = OutputNewrelic

OutputNewrelic.prototype.start = function() {
    let self = this
    this.evtFunction = this.eventHandler.bind(this)
    this.eventEmitter.on('data.parsed', this.evtFunction)
    if (self.config.debug) {
        console.log('logagent-output-new-relic plugin started ' + this.config.url)
    }
    let sendBuffer = self.sendBuffer.bind(this)
    this.timerId = setInterval(function() {
        sendBuffer()
    }, 1000 * this.config.flushInterval)
}

OutputNewrelic.prototype.stop = function(cb) {
    this.eventEmitter.removeListener('data.parsed', this.evtFunction)
    clearInterval(this.timerId)
    cb()
}

OutputNewrelic.prototype.addTobuffer = function(line) {
    this.buffer.push(line + '\n')
    if (this.buffer.length >= this.config.maxBufferSize) {
        this.sendBuffer()
    }
}

OutputNewrelic.prototype.sendBuffer = function() {
    let self = this
    let httpBody = []
    for (let i = 0; i < this.buffer.length; i++) {
        let json = JSON.parse(this.buffer[i])
        if (self.config.fields && self.config.fields[0]) {
            Object.keys(json).map(x => {
                if (self.config.fields.indexOf(x) < 0) {
                    delete json[x]
                }
            })
        }
        json.sendtime = parseInt(Date.now() / 1000)
        httpBody.push(json)
    }
    if (httpBody.length > 0) {
        this.buffer = []
        this.send(httpBody)
    }
}

OutputNewrelic.prototype.send = function(body) {
    if (this.config.debug) {
        console.log('output-newrelic: ', body)
    }
    let self = this
    let headers = {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "X-License-Key": this.config.licenseKey
    }
    let options = {
        method: 'post',
        url: this.config.url,
        headers: headers,
        body: zlib.gzipSync(new Buffer.from(JSON.stringify(body))),
        maxAttempts: 20,
        retryDelay: 3000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError
    }
    request(options, function(err, response, body) {
        if (self.config.debug === true && response && response.attempts) {
            console.log(
                'output-newrelic: ' +
                response.attempts +
                ' attempts ' +
                ' ' +
                options.url +
                ' ' +
                body +
                ' ' +
                response.statusCode
            )
        }
        if (err) {
            self.eventEmitter.emit('error', err)
        }
    })
}

OutputNewrelic.prototype.eventHandler = function(data, context) {
    if (this.config.tags) {
        data.tags = this.config.tags
    }
    let msg = JSON.stringify(data)
    let added = false;
    if (this.config.dropEventTTL && data.ttlactive) {
        if (this.config.debug) console.log('Dropped event due to active TTL', data)
        return null
    }
    if (this.config.filters && Object.keys(this.config.filters).length > 0) {
        Object.keys(this.config.filters).map(filtergroup => {
            if (this.config.filters[filtergroup]) {
                filtergroup = this.config.filters[filtergroup]
                let match, matchValue, matched = false;
                filtergroup.map(filter => {
                    if (filter.field && filter.match) {
                        let fieldName = filter.field
                        matchValue = fieldName.split('.').length > 1 ? data[fieldName.split('.')[0]][fieldName.split('.')[1]] : data[fieldName] || ''
                        match = filter.match
                        if (match.test(matchValue)) {
                            matched = true;
                        } else {
                            matched = false;
                        }
                    }
                })
                if (!added && matched) {
                    added = true
                    return this.addTobuffer(msg)
                } else {
                    if (this.config.debug === true && !added) {
                        console.log(
                            'output-newrelic: filter expression ' +
                            match +
                            ' did not match "' +
                            matchValue + '"',
                            data
                        )
                    }
                }
            }
        })
    } else {
        return this.addTobuffer(msg)
    }
}
