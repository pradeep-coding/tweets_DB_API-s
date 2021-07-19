const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { format, compareAsc } = require("date-fns");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000);
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `SELECT *
                        FROM user
                        WHERE username = '${username}';`;
  const userData = await database.get(getUserQuery);
  if (userData === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const insertUserQuery = `INSERT INTO user
                                (name,username,password,gender)
                                VALUES ('${name}', '${username}', '${hashedPassword}', '${gender}');`;
      await database.run(insertUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT *
                        FROM user
                        WHERE username = '${username}';`;
  const userData = await database.get(getUserQuery);
  if (userData === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    if (await bcrypt.compare(password, userData.password)) {
      const payload = { username: username };
      const jwtToken = await jwt.sign(payload, "My_Secrete_Key");
      response.send({ jwtToken: jwtToken });
      console.log(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authenticatingToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "My_Secrete_Key", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.get(
  "/user/tweets/feed/",
  authenticatingToken,
  async (request, response) => {
    const getUserTweetsQuery = `SELECT username,tweet,date_time AS dateTime
                                FROM user
                                INNER JOIN tweet ON user.user_id = tweet.user_id
                                INNER JOIN follower ON tweet.user_id = follower.following_user_id;`;
    const tweetsArray = await database.all(getUserTweetsQuery);
    response.send(tweetsArray);
  }
);

app.get("/user/following/", authenticatingToken, async (request, response) => {
  const getUserTweetsQuery = `SELECT name
                                FROM user
                                INNER JOIN follower ON user.user_id = follower.following_user_id;`;
  const tweetsArray = await database.all(getUserTweetsQuery);
  response.send(tweetsArray);
});

app.get("/user/followers/", authenticatingToken, async (request, response) => {
  const getUserTweetsQuery = `SELECT name
                                FROM user
                                INNER JOIN follower ON user.user_id = follower.follower_user_id;`;
  const tweetsArray = await database.all(getUserTweetsQuery);
  response.send(tweetsArray);
});

app.get("/tweets/:tweetId/", authenticatingToken, async (request, response) => {
  const { tweetId } = request.params;
  const getUserQuery = `SELECT *
                                FROM user
                                WHERE username = '${request.username}';`;
  const userData = await database.get(getUserQuery);
  const userId = userData.user_id;
  const getTweetsQuery = `SELECT tweet, COUNT(like.user_id) AS likes, COUNT(reply) AS replies, tweet.date_time AS dateTime
                        FROM user
                        INNER JOIN follower ON following_user_id = user.user_id
                        INNER JOIN tweet ON tweet.user_id = following_user_id
                        INNER JOIN reply ON tweet.user_id = reply.user_id
                        INNER JOIN like ON like.user_id = reply.user_id
                        WHERE tweet.tweet_id = ${tweetId}
                        GROUP BY tweet.tweet_id;`;
  const tweetsArray = await database.all(getTweetsQuery);

  const tweetCheckQuery = `SELECT follower_user_id, following_user_id
                            FROM follower 
                            INNER JOIN tweet ON tweet.user_id = following_user_id
                            WHERE tweet.tweet_id = ${tweetId};`;
  const followersData = await database.all(tweetCheckQuery);
  if (
    followersData.some((eachTweet) => eachTweet["follower_user_id"] === userId)
  ) {
    response.send(tweetsArray);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

const objectToArray = (dbObject) => {
  let namesArray = [];
  dbObject.map((eachName) => namesArray.push(eachName["username"]));
  return namesArray;
};

app.get(
  "/tweets/:tweetId/likes/",
  authenticatingToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const getUserQuery = `SELECT *
                                FROM user
                                WHERE username = '${request.username}';`;
    const userData = await database.get(getUserQuery);
    const userId = userData.user_id;
    const getLikesQuery = `SELECT  username
                        FROM user
                        INNER JOIN follower ON following_user_id = user.user_id
                        INNER JOIN tweet ON tweet.user_id = following_user_id
                        INNER JOIN reply ON tweet.user_id = reply.user_id
                        INNER JOIN like ON like.user_id = reply.user_id
                        WHERE tweet.tweet_id = ${tweetId} AND like.user_id = user.user_id
                        GROUP BY tweet.tweet_id
                        ;`;
    const likesArray = await database.all(getLikesQuery);

    const tweetCheckQuery = `SELECT follower_user_id, following_user_id
                            FROM follower 
                            INNER JOIN tweet ON tweet.user_id = following_user_id
                            WHERE tweet.tweet_id = ${tweetId};`;
    const followersData = await database.all(tweetCheckQuery);
    if (
      followersData.some(
        (eachTweet) => eachTweet["follower_user_id"] === userId
      )
    ) {
      response.send({ likes: objectToArray(likesArray) });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticatingToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const getUserQuery = `SELECT *
                                FROM user
                                WHERE username = '${request.username}';`;
    const userData = await database.get(getUserQuery);
    const userId = userData.user_id;
    const getRepliesQuery = `SELECT  name,reply
                        FROM user
                        INNER JOIN follower ON following_user_id = user.user_id
                        INNER JOIN tweet ON tweet.user_id = following_user_id
                        INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
                        WHERE tweet.tweet_id = ${tweetId}
                        GROUP BY tweet.tweet_id
                        ;`;
    const repliesArray = await database.all(getRepliesQuery);

    const tweetCheckQuery = `SELECT follower_user_id, following_user_id
                            FROM follower 
                            INNER JOIN tweet ON tweet.user_id = following_user_id
                            WHERE tweet.tweet_id = ${tweetId};`;
    const followersData = await database.all(tweetCheckQuery);
    if (
      followersData.some(
        (eachTweet) => eachTweet["follower_user_id"] === userId
      )
    ) {
      response.send({ replies: repliesArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticatingToken, async (request, response) => {
  const getTweetsQuery = `SELECT tweet, COUNT(like_id) AS likes, COUNT(reply_id) AS replies, tweet.date_time AS dateTime
                        FROM user
                        INNER JOIN tweet ON tweet.user_id = user.user_id
                        INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
                        INNER JOIN like ON like.tweet_id = reply.tweet_id
                        GROUP BY tweet.tweet_id;`;
  const tweetsArray = await database.all(getTweetsQuery);
  response.send(tweetsArray);
});

app.post("/user/tweets/", authenticatingToken, async (request, response) => {
  const { tweet } = request.body;
  const getUserQuery = `SELECT *
                                FROM user
                                WHERE username = '${request.username}';`;
  const userData = await database.get(getUserQuery);
  const userId = userData.user_id;
  const date = format(new Date(), "yyyy-MM-dd H:m:s");
  const insertTweetQuery = `INSERT INTO tweet
                                (tweet,user_id,date_time) VALUES ('${tweet}',${userId},'${date}');`;
  await database.run(insertTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticatingToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const getUserQuery = `SELECT *
                                FROM user
                                WHERE username = '${request.username}';`;
    const userData = await database.get(getUserQuery);
    const userId = userData.user_id;
    const getTweetQuery = `SELECT *
                            FROM tweet
                            WHERE tweet_id = ${tweetId};`;
    const tweet = await database.get(getTweetQuery);
    if (tweet.user_id === userId) {
      const deleteTweetQuery = `DELETE FROM tweet
                                    WHERE tweet_id = ${tweetId};`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
