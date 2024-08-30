# Serverless SCALEX

Serverless Framework plugin to support the request at scale via HTTP_PROXY integration.

The plugin allows you to switch apigatewayv2 routing integration from AWS_PROXY to HTTP_PROXY and vice versa. This allows for the request to be scaled to HTTP endpoint such as app runner.

## Installing the Plugin

```
npm install --save-dev serverless-scalex
npm uninstall serverless-scalex
```

## Serverless Configuration

There isn't any configuration needed at the top level, you just need to replace `sns` event with `snsx` event at function level.

The configuration should be defined either like the first or the second sample.

```
events:
  - httpApi:
      scale: true
      scaleUrl: HTTP_ENDPOINT/api/v1/something
      path: /api/v1/ping
      method: get

events:
  - httpApi:
      scale: false # or omitted
      path: /api/v1/ping
      method: get

custom:
  scalex:
    bucketName: "scalex-state-bucket-8k37fy"
```

When you set `scale: true`, `scaleUrl` becomes a required parameter. A new HTTP integration will be created and the route integration will be switched to HTTP without deleting the Lambda integration.

When you later set the `scale: false`, the route integration will be switched to the Lambda integration and the HTTP integration will be deleted.

The `custom.scalex.bucketName` is a required parameter to store the state file. We use a state file to keep track of created HTTP integration so we can later remove the integration when there are configuration changes.

When the configuration is deployed, there will be warning related to `Invalid configuration encountered` of `unsupported function event` but in our deployment, it is safe to ignore.

---

**2024 Randy Hermawan**
