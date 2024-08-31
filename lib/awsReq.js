class AwsReq {
  constructor(serverless, options, logger) {
    this.provider = serverless.getProvider("aws");
    this.options = options;
    this.logger = logger;
  }

  S3CheckBucket = (bucketName) => {
    const _self = this;

    return _self.provider.request(
      "S3",
      "getBucketPolicyStatus",
      { Bucket: bucketName },
      _self.options.stage,
      _self.options.region
    );
  };

  S3GetObject = (bucketName, key) => {
    const _self = this;

    return _self.provider.request(
      "S3",
      "getObject",
      { Bucket: bucketName, Key: key },
      _self.options.stage,
      _self.options.region
    );
  };

  S3PutObject = (bucketName, key, body) => {
    const _self = this;

    return _self.provider.request(
      "S3",
      "putObject",
      { Bucket: bucketName, Key: key, Body: body },
      _self.options.stage,
      _self.options.region
    );
  };

  S3DeleteObject = (bucketName, key) => {
    const _self = this;

    return _self.provider.request(
      "S3",
      "deleteObject",
      { Bucket: bucketName, Key: key },
      _self.options.stage,
      _self.options.region
    );
  };

  GetApiId = (apiName) => {
    const _self = this;

    return _self.provider
      .request(
        "ApiGatewayV2",
        "getApis",
        {},
        _self.options.stage,
        _self.options.region
      )
      .then((res) => {
        const targetApi = res.Items.find((v) => v.Name === apiName);
        if (targetApi) {
          return targetApi.ApiId;
        }
        _self.logger.error(
          `Error retrieving api gateway id: no matched api gateway found`
        );
        process.exit(1);
      })
      .catch((err) => {
        _self.logger.error(`Error retrieving api gateway id: ${err}`);
        process.exit(1);
      });
  };

  ListIntegrations = async (apiId) => {
    const _self = this;

    const items = [];
    let nextToken = null;

    try {
      do {
        const params = { ApiId: apiId };
        if (nextToken) {
          params.NextToken = nextToken;
        }

        const res = await _self.provider.request(
          "ApiGatewayV2",
          "getIntegrations",
          params,
          _self.options.stage,
          _self.options.region
        );

        items.push(...res.Items);
        nextToken = res.NextToken;
      } while (nextToken);

      return items;
    } catch (err) {
      _self.logger.error(`Error listing api gateway integrations: ${err}`);
      process.exit(1);
    }
  };

  ListRoutes = async (apiId) => {
    const _self = this;

    const items = [];
    let nextToken = null;

    try {
      do {
        const params = { ApiId: apiId };
        if (nextToken) {
          params.NextToken = nextToken;
        }

        const res = await _self.provider.request(
          "ApiGatewayV2",
          "getRoutes",
          params,
          _self.options.stage,
          _self.options.region
        );

        items.push(...res.Items);
        nextToken = res.NextToken;
      } while (nextToken);

      return items;
    } catch (err) {
      _self.logger.error(`Error listing api gateway routes: ${err}`);
      process.exit(1);
    }
  };

  CreateHttpIntegration = (apiId, method, uri) => {
    const _self = this;

    return _self.provider
      .request(
        "ApiGatewayV2",
        "createIntegration",
        {
          ApiId: apiId,
          IntegrationType: "HTTP_PROXY",
          PayloadFormatVersion: "1.0",
          IntegrationMethod: method.toUpperCase(),
          IntegrationUri: uri,
        },
        _self.options.stage,
        _self.options.region
      )
      .then((res) => res.IntegrationId)
      .catch((err) => {
        _self.logger.error(`Error creating http integration: ${err}`);
        process.exit(1);
      });
  };

  UpdateHttpIntegration = (apiId, integrationId, uri) => {
    const _self = this;

    return _self.provider
      .request(
        "ApiGatewayV2",
        "updateIntegration",
        {
          ApiId: apiId,
          IntegrationId: integrationId,
          IntegrationUri: uri,
        },
        _self.options.stage,
        _self.options.region
      )
      .catch((err) => {
        _self.logger.error(`Error updating http integration: ${err}`);
        process.exit(1);
      });
  };

  DeleteIntegration = (apiId, integrationId) => {
    const _self = this;

    return _self.provider
      .request(
        "ApiGatewayV2",
        "deleteIntegration",
        {
          ApiId: apiId,
          IntegrationId: integrationId,
        },
        _self.options.stage,
        _self.options.region
      )
      .catch((err) => {
        if (!err.message.includes("Invalid Integration identifier specified")) {
          _self.logger.error(`Error deleting http integration: ${err}`);
          process.exit(1);
        }
      });
  };

  UpdateRouteIntegration = (apiId, routeId, authorizerId, integrationId) => {
    const _self = this;

    const params = { ApiId: apiId, RouteId: routeId };

    if (integrationId) params.Target = `integrations/${integrationId}`;
    if (authorizerId) {
      if (authorizerId === "remove") params.AuthorizationType = "NONE";
      else {
        params.AuthorizationType = "CUSTOM";
        params.AuthorizerId = authorizerId;
      }
    }

    return _self.provider
      .request(
        "ApiGatewayV2",
        "updateRoute",
        params,
        _self.options.stage,
        _self.options.region
      )
      .catch((err) => {
        _self.logger.error(`Error updating route integration: ${err}`);
        process.exit(1);
      });
  };
}

module.exports = AwsReq;
