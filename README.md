# logagent-output-new-relic

Plugin for [Logagent](https://sematext.com/logagent) to collect windows events 

1) Install [logagent 2.x](https://www.npmjs.com/package/@sematext/logagent) 
```
npm i -g @sematext/logagent
```
2) Install this plugin 
```
npm i -g https://github.com/razb/logagent-output-new-relic
```
3) configure logagent 
```
input:
  files:
      - /logs/*.log
  output:
    module: logagent-output-new-relic
    url: https://log-api.newrelic.com/log/v1
    licenseKey: XXXXXXXXXXXXXXXXXXXXXXXXXX
    # maximum number of events per request
    # 1 - each event creates a separate http request
    # >1 - multiple events in each http request
    maxBufferSize: 10
    # flush interval in seconds
    flushInterval: 10
```
4) Start logagent
```
logagent --config config.yml
