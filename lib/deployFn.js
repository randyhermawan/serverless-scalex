const AwsReq = require("./awsReq");

class DeployFunc {
  constructor(serverless, options, logger) {
    this.serverless = serverless;
    this.options = options;
    this.logger = logger;

    this.awsReq = new AwsReq(serverless, options, logger);
  }

  ConfigureEvent = async (fnName, fnDef, evtDef, apiData) => {
    const _self = this;

    // Retrieve target route object for the defined event
    const fnRouteKey = `${evtDef.method.toUpperCase()} ${evtDef.path}`;
    const targetRoute = apiData.Routes.find((v) => v.RouteKey === fnRouteKey);
    if (!targetRoute) {
      _self.logger.error(
        `Error retrieving api gateway route for ${fnName}: no matched route found`
      );
    }

    // Retrieve target integration object for the defined event
    const targetIntegration = apiData.Integrations.find(
      (v) => v.IntegrationId === targetRoute.Target.split("/")[1]
    );
    if (!targetIntegration) {
      _self.logger.error(
        `Error retrieving api gateway integration for ${fnName}: no matched integration found`
      );
    }

    const isScale = (evtDef.scale?.region || []).includes(_self.options.region);
    const isHttpProxy = targetIntegration.IntegrationType === "HTTP_PROXY";
    const isLambdaProxy = targetIntegration.IntegrationType === "AWS_PROXY";

    if (isLambdaProxy && !isScale) {
      return;
    }

    // Validate http URL if scale policy is already in sync
    if (isHttpProxy && isScale) {
      if (targetIntegration.IntegrationUri !== evtDef.scale.httpUrl) {
        await _self.awsReq.UpdateHttpIntegration(
          apiData.ApiId,
          targetIntegration.IntegrationId,
          evtDef.scale.httpUrl
        );
        console.log(
          `[scalex event] function '${fnName}' integration uri updated`
        );

        return targetIntegration.IntegrationId;
      }

      var authorizerId = null;
      if (evtDef.authorizer && evtDef.authorizer.id) {
        if (evtDef.scale.keepAuthorizer) {
          if (targetRoute.AuthorizerId !== evtDef.authorizer.id)
            authorizerId = evtDef.authorizer.id;
        } else if (targetRoute.AuthorizerId) authorizerId = "remove";
      } else if (targetRoute.AuthorizerId) authorizerId = "remove";

      if (authorizerId) {
        await _self.awsReq.UpdateRouteIntegration(
          apiData.ApiId,
          targetRoute.RouteId,
          authorizerId
        );

        console.log(
          `[scalex event] function '${fnName}' authorizer integration update`
        );
      } else
        console.log(
          `[scalex event] function '${fnName}' scale status already in-sync`
        );

      return targetIntegration.IntegrationId;
    }

    // Attach the AWS_PROXY integration to the route and delete the HTTP_PROXY integration
    if (isHttpProxy && !isScale) {
      const lambdaIntegration = apiData.Integrations.find(
        (v) =>
          v.IntegrationType === "AWS_PROXY" &&
          v.IntegrationUri.endsWith(`function:${fnDef.name}`)
      );

      // If authorizer defined in the config, set the authorizer
      var authorizerId = "remove";
      if (evtDef.authorizer && evtDef.authorizer.id)
        authorizerId = evtDef.authorizer.id;

      await _self.awsReq.UpdateRouteIntegration(
        apiData.ApiId,
        targetRoute.RouteId,
        authorizerId,
        lambdaIntegration.IntegrationId
      );

      await _self.awsReq.DeleteIntegration(
        apiData.ApiId,
        targetIntegration.IntegrationId
      );

      console.log(
        `[scalex event] function '${fnName}' scaled DOWN to AWS_PROXY`
      );

      return;
    }

    // Create new HTTP_PROXY integration and attach it to the route
    if (isLambdaProxy && isScale) {
      const integrationId = await _self.awsReq.CreateHttpIntegration(
        apiData.ApiId,
        evtDef.method,
        evtDef.scale.httpUrl
      );

      // If authorizer defined in the config, set the authorizer
      var authorizerId = "remove";
      if (
        evtDef.authorizer &&
        evtDef.authorizer.id &&
        evtDef.scale.keepAuthorizer === true
      )
        authorizerId = evtDef.authorizer.id;

      await _self.awsReq.UpdateRouteIntegration(
        apiData.ApiId,
        targetRoute.RouteId,
        authorizerId,
        integrationId
      );

      console.log(
        `[scalex event] function '${fnName}' scaled UP to HTTP_PROXY`
      );

      return integrationId;
    }
  };

  PostConfigure = async (apiId, integrationIds) => {
    const { serverless, awsReq, logger } = this;

    const currentState = integrationIds.join("__");

    const bucketName = serverless.service.custom?.scalex?.bucketName;
    const key = `${serverless.service.provider.stage}-${serverless.service.service}-${serverless.service.provider.region}-scalex-state.txt`;

    var stateAction = "new";

    try {
      const resp = await awsReq.S3GetObject(bucketName, key);
      const remoteState = resp.Body.toString().split("__");

      const unmatchedIds = remoteState.filter(
        (integrationId) => !currentState.includes(integrationId)
      );

      let integrationRemoved = false;

      if (unmatchedIds.length > 0) {
        await Promise.all(
          unmatchedIds.map(async (integrationId) => {
            await awsReq.DeleteIntegration(apiId, integrationId);
            console.log(
              `[scalex event] unused HTTP_PROXY integration '${integrationId}' removed`
            );
            integrationRemoved = true;
          })
        );
      }

      if (remoteState.length === 0) {
        stateAction = "new";
      } else if (
        remoteState.length === integrationIds.length &&
        !integrationRemoved
      ) {
        stateAction = "sync";
      } else if (
        remoteState.length !== integrationIds.length ||
        integrationRemoved
      ) {
        stateAction = "update";
      }
    } catch (error) {
      if (error.code !== "AWS_S3_GET_OBJECT_NO_SUCH_KEY") {
        logger.error(`Error checking scalex state file: ${error}`);
        process.exit(1);
      }
    }

    if (stateAction === "new" || stateAction === "update") {
      try {
        await awsReq.S3PutObject(bucketName, key, currentState);
        if (stateAction === "new")
          console.log(
            `[scalex event] new state file created using deployment state`
          );
        else
          console.log(
            `[scalex event] current deployment state updated to state file`
          );
      } catch (error) {
        logger.error(`Error setting new state to scalex state file: ${error}`);
        process.exit(1);
      }
    } else
      console.log(
        `[scalex event] state file is in-sync with current deployment state`
      );
  };
}

module.exports = DeployFunc;
