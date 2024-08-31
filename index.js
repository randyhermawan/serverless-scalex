"use strict";

const AwsReq = require("./lib/awsReq");
const DeployFunc = require("./lib/deployFn");

class ServerlessPlugin {
  constructor(serverless, options, { log }) {
    this.serverless = serverless;
    this.options = options;
    this.logger = log;

    this.awsReq = new AwsReq(serverless, options, log);
    this.deployFn = new DeployFunc(serverless, options, log);

    this.hooks = {
      "before:deploy:deploy": this.Validate.bind(this),
      "after:deploy:deploy": this.Deploy.bind(this),
      "after:remove:remove": this.Destroy.bind(this),
    };

    serverless.configSchemaHandler.defineCustomProperties({
      type: "object",
      properties: {
        scalex: {
          type: "object",
          properties: { bucketName: { type: "string" } },
          required: ["bucketName"],
        },
      },
      required: ["scalex"],
    });

    serverless.configSchemaHandler.defineFunctionEventProperties(
      "aws",
      "httpApi",
      {
        properties: {
          scale: {
            type: "object",
            properties: {
              region: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
              },
              httpUrl: { type: "string" },
              keepAuthorizer: {
                type: "boolean",
                default: false,
              },
            },
            required: ["region", "httpUrl"], // Ensures both properties must exist
          },
        },
      }
    );
  }

  Validate = async () => {
    const bucketName = this.serverless.service.custom?.scalex?.bucketName;
    if (!bucketName) {
      this.logger.error(
        `Missing required serverless parameter at custom.scalex.bucketName`
      );
      process.exit(1);
    }

    Object.entries(this.serverless.service.functions).flatMap(
      ([fnName, fnDef]) =>
        (fnDef.events || []).map((evt, i) => {
          if (evt.httpApi.scale) {
            if (!evt.httpApi.scale.region) {
              this.logger.error(
                `Missing required parameter at ${fnName}.events[${i}].httpApi.scale.region`
              );
              process.exit(1);
            }

            if (!Array.isArray(evt.httpApi.scale.region)) {
              this.logger.error(
                `Wrong parameter type: Requires an Array at ${fnName}.events[${i}].httpApi.scale.region`
              );
              process.exit(1);
            }

            if (
              (evt.httpApi.scale.region.includes(this.options.region) ||
                false) &&
              !evt.httpApi.scale.httpUrl
            ) {
              this.logger.error(
                `Missing required serverless parameter at ${fnName}.events[${i}].httpApi.scale.httpUrl`
              );
              process.exit(1);
            }
          }
        })
    );
  };

  Deploy = async () => {
    this._checkS3Bucket();

    const apiId = await this._getApiId();
    const apiData = {
      ApiId: apiId,
      Integrations: await this.awsReq.ListIntegrations(apiId),
      Routes: await this.awsReq.ListRoutes(apiId),
    };

    const configurePromises = Object.entries(
      this.serverless.service.functions
    ).flatMap(([fnName, fnDef]) =>
      (fnDef.events || [])
        .filter((evt) => evt.httpApi)
        .map((evt) =>
          this.deployFn.ConfigureEvent(fnName, fnDef, evt.httpApi, apiData)
        )
    );

    const results = await Promise.all(configurePromises);
    const integrationIds = [...results].filter((v) => v !== undefined);

    this.deployFn.PostConfigure(apiData.ApiId, integrationIds);
  };

  Destroy = async () => {
    const { serverless, awsReq, logger } = this;

    this._checkS3Bucket();

    const bucketName = serverless.service.custom?.scalex?.bucketName;
    const key = `${serverless.service.provider.stage}-${serverless.service.service}-${serverless.service.provider.region}-scalex-state.txt`;

    const apiId = await this._getApiId();

    try {
      const resp = await awsReq.S3GetObject(bucketName, key);
      const remoteState = resp.Body.toString().split("__");

      await Promise.all(
        remoteState.map(async (integrationId) => {
          await awsReq.DeleteIntegration(apiId, integrationId);
          console.log(
            `[scalex event] HTTP_PROXY integration '${integrationId}' removed`
          );
        })
      );

      console.log(`[scalex event] all deployed HTTP_PROXY integration removed`);
    } catch (error) {
      if (error.code !== "AWS_S3_GET_OBJECT_NO_SUCH_KEY") {
        logger.error(
          `Error cleaning up integration based on scalex state file: ${error}`
        );
        process.exit(1);
      }
    }

    try {
      await awsReq.S3DeleteObject(bucketName, key);
      console.log(`[scalex event] scalex state file deleted`);
    } catch (error) {
      logger.error(`Error deleting scalex state file: ${error}`);
      process.exit(1);
    }
  };

  _checkS3Bucket = () => {
    const _self = this;

    const bucketName = _self.serverless.service.custom?.scalex?.bucketName;

    _self.awsReq
      .S3CheckBucket(bucketName)
      .then(() => {
        console.log(`[scalex event] state bucket '${bucketName}' is valid`);
      })
      .catch(function (error) {
        _self.logger.error(`Error retrieving s3 bucket info: ${error}`);
        process.exit(1);
      });
  };

  _getApiId = async () => {
    const _self = this;

    let apiId = _self.serverless.service.provider.httpApi?.id;
    if (!apiId) {
      apiId = await _self.awsReq.GetApiId(
        `${_self.options.stage}-${_self.serverless.service.service}`
      );
    }

    return apiId;
  };
}

module.exports = ServerlessPlugin;
