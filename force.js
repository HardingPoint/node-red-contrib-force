/**
 * Copyright 2014 Atsushi Kojo.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {
  'use strict';
  var jsforce = require('jsforce');
  var request = require('request');

  function ForceNode(n) {
    RED.nodes.createNode(this, n);
    var node = this;

    var credentials = RED.nodes.getCredentials(n.id);

    // Backwards Compatible
    if (!credentials){
        credentials = this.credentials;
    }

    this.login = function (callback, msg) {
      var accessToken = process.env.SFDC_ACCESSTOKEN || msg.accessToken || credentials.accessToken;
      var instanceUrl = process.env.SFDC_INSTANCEURL || msg.instanceUrl || credentials.instanceUrl;

      if (n.logintype == "oauth") {
          var error;
          if (!accessToken || !instanceUrl) {
              error = JSON.parse('["' + "No Authenticate specified" + '"]');
          }
          var conn = new jsforce.Connection({
            oauth2 : {
                clientId : credentials.clientid,
                clientSecret : credentials.clientsecret,
                redirectUri : null
            }
          });
          conn.initialize({
              accessToken : accessToken,
              refreshToken : credentials.refreshToken,
              instanceUrl : instanceUrl
          });
          callback(conn, error);

      } else if (n.logintype == "Username-Password") {
          var conn = new jsforce.Connection({
            loginUrl: n.loginurl
          });
          var error;

          conn.login(n.username, credentials.password, function (err, userInfo) {
            if (err) {
                console.log("[GRAX.io] ForceInNode.login Exception - " + err);
                error = err;
            }
            callback(conn, error);
          });
      } else if (n.logintype == "Signed-Request") {
          var conn = new jsforce.Connection({
            accessToken : accessToken,
            instanceUrl : instanceUrl
          });
          callback(conn, error);
      }
    }
  }


  RED.nodes.registerType('force', ForceNode, {
    credentials: {
      password: { type: 'password' },
      clientid: { type: 'password' },
      clientsecret: { type: 'password' },
      accessToken : { type: 'password' },
      refreshToken : { type: 'password' },
      instanceUrl : { type: 'text' }
    }
  });

  RED.httpAdmin.get('/credentials/:id/force-credentials', function(req, res) {
    var forceConfig = RED.nodes.getNode(req.params.id);
    var clientid,
        clientsecret;
    if (forceConfig && forceConfig.credentials && forceConfig.credentials.clientid) {
        clientid = forceConfig.credentials.clientid;
    } else {
        clientid = req.query.clientid;
    }
    if (forceConfig && forceConfig.credentials && forceConfig.credentials.clientsecret) {
        clientsecret = forceConfig.credentials.clientsecret;
    } else {
        clientsecret = req.query.clientsecret;
    }
    var credentials = {
        clientid: clientid,
        clientsecret: clientsecret,
        redirectUri : req.query.callback
    };
    RED.nodes.addCredentials(req.params.id, credentials);

    var oauth2 = new jsforce.OAuth2({
      loginUrl: req.query.loginurl,
      clientId : clientid,
      redirectUri : req.query.callback
    });
    var authUrl = oauth2.getAuthorizationUrl();
    if (req.query.username) authUrl = authUrl + '&login_hint=' + req.query.username;

    var resData = {};
    resData.authUrl = authUrl;
    res.send(resData);
  });

  RED.httpAdmin.get('/force-credentials/:id/auth/callback', function(req, res) {
    if(!req.query.code){
        var sendHtml = "<html><head></head><body>ERROR: not return Authorization code</body></html>";
        return res.send(sendHtml);
    }
    var forceConfig = RED.nodes.getCredentials(req.params.id);

    var conn = new jsforce.Connection({
        oauth2 : {
            clientId : forceConfig.clientid,
            clientSecret : forceConfig.clientsecret,
            redirectUri : forceConfig.redirectUri
        }
    });

    conn.authorize(req.query.code, function(err, userInfo) {
        if (err) {
          node.error(err.toString());
          node.status({ fill: 'red', shape: 'ring', text: 'failed' });
          var sendHtml = "<html><head></head><body>" + err.toString() + "</body></html>";
          return res.send(sendHtml);
        }

        var credentials = {
            clientid: forceConfig.clientid,
            clientsecret: forceConfig.clientsecret,
            accessToken: conn.accessToken,
            refreshToken: conn.refreshToken,
            instanceUrl: conn.instanceUrl
        };
        RED.nodes.addCredentials(req.params.id, credentials);

        var sendHtml = "<html><head></head><body>Authorised - you can close this window and return to Node-RED</body></html>";
        res.send(sendHtml);
      });
  });

  function ForceInNode(n) {
    RED.nodes.createNode(this, n);
    this.force = n.force;
    this.sobject = n.sobject;
    this.extname = n.extname;
    this.operation = n.operation;
    this.forceConfig = RED.nodes.getNode(this.force);
    if (this.forceConfig) {
      var node = this;
      node.convType = function (payload, targetType) {
        try{
            if (typeof payload !== targetType) {
                if (targetType == 'string') {
                    payload = JSON.stringify(payload);
                } else {
                    payload = JSON.parse(payload);
                }
            }
        }catch(err){
            console.log("[GRAX.io] ForceInNode.convType Exception - " + err);
            console.log("[GRAX.io] payload : " + JSON.stringify(payload));
        }
        return payload;
      };
      node.on('input', function (msg) {
        node.sendMsg = function (err, result) {
          if (err) {
            node.error(err.toString());
            node.status({ fill: 'red', shape: 'ring', text: 'failed' });
            console.log("[GRAX.io] ForceInNode.sendMsg (" + err.toString() + "):" + JSON.stringify(msg));
          } else {
            node.status({});
          }
          msg.payload = result;
          node.send(msg);
        };
        this.forceConfig.login(function (conn, err) {
          if(err){
            node.sendMsg(err);
            return;
          }
          switch (node.operation) {
            case 'query':
              try{
                  msg.payload = node.convType(msg.payload, 'string');
                  conn.query(msg.payload, node.sendMsg);
              }catch(err){
                  console.log("[GRAX.io] ForceInNode.query Exception - " + err);
                  console.log("[GRAX.io] ForceInNode.query payload : " + JSON.stringify(msg));
              }
              break;
            case 'create':
              msg.payload = node.convType(msg.payload, 'object');
              conn.sobject(node.sobject)
                .create(msg.payload, node.sendMsg);
              break;
            case 'update':
              msg.payload = node.convType(msg.payload, 'object');
              conn.sobject(node.sobject)
                .update(msg.payload, node.sendMsg);
              break;
            case 'upsert':
                try{
                    msg.payload = node.convType(msg.payload, 'object');
                    conn.sobject(node.sobject)
                        .upsert(msg.payload, node.extname, node.sendMsg);
                }catch(err){
                    console.log("[GRAX.io] ForceInNode.upsert Exception - " + err);
                    console.log("[GRAX.io] payload : " + JSON.stringify(msg));
                }
              break;
            case 'delete':
              msg.payload = node.convType(msg.payload, 'object');
              conn.sobject(node.sobject)
                .destroy(msg.payload, node.sendMsg);
              break;
          }
        }, msg);
      });
    } else {
      this.error('missing force configuration');
    }
  }
  RED.nodes.registerType('force in', ForceInNode);

};
