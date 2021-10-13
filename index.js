'use strict'
var request = require('requestretry')
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
    if (
        this.config.filter &&
        this.config.filter.match &&
        this.config.filter.field
    ) {
        this.config.filter.match = RegExp(this.config.filter.match)
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
    var self = this
    this.evtFunction = this.eventHandler.bind(this)
    this.eventEmitter.on('data.parsed', this.evtFunction)
    if (self.config.debug) {
        console.log('logagent-output-new-relic plugin started ' + this.config.url)
    }
    var sendBuffer = self.sendBuffer.bind(this)
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
    for (var i = 0; i < this.buffer.length; i++) {
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
    var self = this
    var headers = {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "X-License-Key": this.config.licenseKey
    }
    var options = {
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
    var msg = JSON.stringify(data)
    if (this.config.filter !== undefined) {
        var fieldName = this.config.filter.field || 'logSource'
        var matchValue = data[fieldName] || ''
        var match = this.config.filter.match
        if (match.test(matchValue)) {
            return this.addTobuffer(msg)
        } else {
            if (this.config.debug === true) {
                console.log(
                    'output-newrelic: filter expression' +
                    match +
                    ' did not match ' +
                    matchValue
                )
            }
        }
    } else {
        return this.addTobuffer(msg)
    }
}