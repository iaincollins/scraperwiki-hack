var Q = require('q');
var request = require('request');
var moment = require('moment');
var config = require(__dirname + '/config.json');
var newsQuery = require('newsquery')(config.bbcNewsLabs.apiKey);
var util = require('util');

GLOBAL.actors = {};
GLOBAL.interestingActors = {};

(new function() {
    var promises = [];
    var frame = 'Hostile_encounter';
    for (var i = 1; i <= 500; i++) {
        var url = 'https://newsreader.scraperwiki.com/summary_of_events_with_framenet/page/'+i+'?uris.0=framenet%3A'+encodeURIComponent(frame)+'&output=json';
        var promise = getUrl(url);
        promises.push(promise);
    }
    return Q.all(promises);
})
.then(function(results) {
    var events = [];
    results.forEach(function(page) {
        if (!page.payload)
            return;
        page.payload.forEach(function(event) {
            events.push(event.event);
        });
    });
    return events;
})
.then(function(events) {
    var promises = []; 
    events.forEach(function(event) {
        var url = 'https://newsreader.scraperwiki.com/describe_uri?uris.0='+ encodeURIComponent(event) +'&output=json';
        var eventName = event.replace(/^(.*)#/, '').replace(/Event$/, '');
        var promise = getUrl(url)
        .then(function(response) {
            if (response.payload['@graph'][0]['sem:hasActor'] instanceof Array) {
                response.payload['@graph'][0]['sem:hasActor'].forEach(function(actor) {
                    var actor = actor['@id'];
                    addActor(actor, eventName);
                });
            } else {
                if (response.payload['@graph'][0]['sem:hasActor']) {
                    var actor = response.payload['@graph'][0]['sem:hasActor']['@id'];
                    addActor(actor, eventName);
                }
            }
        });
        promises.push(promise);
   });
   return Q.all(promises);
})
.then(function(results) {
    var promises = [];
    for (var actor in actors) {
        var promise = newsQuery.getConcept("http://dbpedia.org/resource/"+actor, 5)
        .then(function(concept) {
            if (!concept.uri)
                return;

            var actorName = concept.uri.replace(/http:\/\/dbpedia\.org\/resource\//, '');
            if (concept.type != 'undefined') {
                actors[actorName].type = concept.type;
            } else {
               // console.log("Couldn't find DBPedia concept for "+actorName);
            }
            
            return true;
        });
        promises.push(promise);
    }
    return Q.all(promises);
})
.then(function() {
    var promises = [];
    for (var actorName in actors) {
        var actor = actors[actorName];
        if (actor.type.indexOf('http://dbpedia.org/ontology/Person') != -1) {
            var url = 'http://dbpedia.org/sparql?default-graph-uri=http%3A%2F%2Fdbpedia.org&query=select+%3Fteam+%3Fteamid+where+%0D%0A%7B%0D%0A+++dbpedia%3A'+encodeURIComponent(actorName)+'+dbpedia-owl%3Ateam+%3Fteamid%0D%0A+++FILTER+NOT+EXISTS+%7B+%3Fplayers+dbpprop%3Anationalteam+%3Fteamid%7D+.%0D%0A+++%3Fteamid+dbpprop%3Aclubname+%3Fteam%0D%0A%7D&format=application%2Fsparql-results%2Bjson&timeout=30000&debug=on';
            var promise = getUrl(url)
             .then(function(response) {
                 if (!response.results)
                     return;
                 //console.log(actorName+" callback");
                 if (response.results.bindings) {
                     response.results.bindings.forEach(function(team) {
                         var teamName = team.teamid.value.replace(/http:\/\/dbpedia\.org\/resource\//, '');
                         addInterestingActor(teamName);
                     });
                 } else {
                 //    console.log(response);
                 }
             });
             promises.push(promise);
        } else if (actor.type.indexOf('http://dbpedia.org/ontology/Organisation') != -1) {
           if (actor.type.indexOf('http://dbpedia.org/ontology/SoccerClub') != -1 ||
              actor.type.indexOf('http://dbpedia.org/ontology/SportsTeam') != -1 ) {
              addInterestingActor(actorName);
           }
        } else if (actor.type.indexOf('http://dbpedia.org/ontology/Country') != -1) {
            addInterestingActor(actorName);
        }
    }
   return Q.all(promises);
})
.then(function(results) {
    var promises = [];
    for (var actor in interestingActors) {
        var promise = newsQuery.getConcept("http://dbpedia.org/resource/"+actor, 5)
        .then(function(concept) {
            if (!concept.uri)
                return;

            var actorName = concept.uri.replace(/http:\/\/dbpedia\.org\/resource\//, '');
            if (concept.type != 'undefined')
                interestingActors[actorName].type = concept.type;

            return true;
        });
        promises.push(promise);
    }
    return Q.all(promises);
})
.then(function(results) {
    //console.log(actors);
    var sorted = [];
    for (var actor in interestingActors)
          sorted.push([actor, interestingActors[actor]])
    sorted.sort(function(a, b) {return b[1].total - a[1].total });
//    console.log( util.inspect(sorted, true, 10) );
    console.log(sorted);
    console.log("Done");
    // console.log(results.length);
});

function addActor(actor, event) {
    if (actor.match(/^dbpedia:/)) {
        actor = actor.replace(/^dbpedia:/, '');
        if (!actors[actor]) {
            actors[actor] = { total: 1, events: {}, type: [], teams: [] };
        } else {
            actors[actor].total++;
        }
        if (!actors[actor].events[event]) {
            actors[actor].events[event] = 1;
        } else {
            actors[actor].events[event]++;
        }
    }
}

function addInterestingActor(actor) {
    if (!interestingActors[actor]) {
        interestingActors[actor] = { total: 1, type: [] };
    } else {
        interestingActors[actor].total++;
    }
}

function getUrl(url, callback) {
    var deferred = Q.defer();
    request(url, function (error, response, body) {
        if (error || response.statusCode != "200") {
            deferred.resolve({});
            console.log("Error from "+url+": "+error);
        } else {
            if (typeof(callback) === "function") {
                callback.call(this, JSON.parse(body));
                return;
            } else {
                deferred.resolve(JSON.parse(body));
            }
        }
    });
    return deferred.promise;
};