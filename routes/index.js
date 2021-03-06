require('dotenv').config();
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const youtubeUpload = require('../insert/uploads.js');
const analytics = require('../insert/analytics.js');
const ipfs = require('../ipfs/addVideoIpfs');
const Thumbler = require('thumbler');
const fetch = require('node-fetch');

const client = require('../client.js');
const url = require('url');
const User = require('../task-manager/src/models/user');

const { getVideoDurationInSeconds } = require('get-video-duration');
const fs = require('fs');

let videoInfo = {};

// Set Storage of uploaded video or file on the server
let storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './public/uploads');
  },
  filename: function(req, file, cb) {
    cb(null, 'video' + path.extname(file.originalname));
  }
});

let upload = multer({
  storage: storage
});

const thumbler = (time, callback) => {
  let thumb = Thumbler(
    {
      type: 'video',
      input: videoInfo.videoFilePath,
      output: './public/uploads/thumb.jpg',
      time: time,
      size: '300x200' // this optional if null will use the dimentions of the video
    },
    function(err, path) {
      if (err) return err;
      return callback();
    }
  );
};

//Runs async addFile function to get hash for ipfs
const getIpfsHash = async () => {
  let link = await ipfs
    .addFile(videoInfo)
    .then((data) => {
      console.log('ipfs data: ', data);
      console.log('https://ipfs.io/ipfs/' + data);
      return data;
    })
    .catch(console.err);
  return link;
};

const youtubeupload = async (req, res) => {
  try {
    const uploaded = await youtubeUpload
      .runUpload(videoInfo)
      .then((data) => {
        return data;
      })
      .catch((err) => console.log(err));
    return uploaded;
  } catch (e) {
    console.log(e);
    return 'Syntax Error';
  }
};

router.post('/uploaded', upload.single('myFiles'), async (req, res) => {
  console.log('req body: ', req.body.body);
  const body = req.body.body;
  const file = req.file;
  console.log(file);
  videoInfo.title = body[0];
  videoInfo.desc = body[1];
  videoInfo.videoFilePath = './' + file.path;
  videoInfo.videoFileName = file.filename;
  videoInfo.imgFilePath = './public/uploads/thumb.jpg';
  videoInfo.imgFileName = 'thumb.jpg';

  let seconds = await getVideoDurationInSeconds(videoInfo.videoFilePath);
  seconds *= 0.25;
  let min = 60;
  let hr = 60 * min;

  let th = Math.floor(seconds / hr);
  seconds -= th * hr;
  let tm = Math.floor(seconds / min);
  seconds -= tm * min;
  let ts = Math.floor(seconds);

  let sth = th < 10 ? '0' + th : '' + th;
  let stm = tm < 10 ? '0' + tm : '' + tm;
  let sts = ts < 10 ? '0' + ts : '' + ts;

  let time = `${sth}:${stm}:${sts}`;

  console.log(videoInfo.videoFilePath, 'time: ', time);
  //Grabs thumbnail from video and saves it
  thumbler(time, () => {
    res.render('dashboard', {
      title: 'Streambed'
    });
  });
});

router.get('/uploaded', (req, res) => {
  res.send([videoInfo]);
});

/* Sending data back to React componant for upload route */
router.get('/upload', (req, res) => {
  res.render('dashboard', { token: accessToken });
});

/* GET login page. */
router.get('/', function(req, res, next) {
  const { userId } = req.session;

  //If session id exist skips login / signup page and back to the users dashboard
  if (userId) {
    res.redirect('/users/login');
  } else {
    res.render('index', { title: 'Streambed' });
  }
});

/* GET analytics page. */
router.get('/analytics', function(req, res, next) {
  analytics
    .runVideoAnalytics()
    .then((data) => {
      console.log('the video Analytic result: ', data);
      res.send({ data });
    })
    .catch(console.err);
});

/* POST route for video file up to youtube*/
router.post('/upload-youtube', async (req, res) => {
  let keys = Object.keys(req.body);

  // //! Fetch to refrech access token on upload to solve token problem HOPEFULLY
  // const isNewAccessToken = await fetch('/users/rt');
  // console.log('index.js LOOK FOR RED', isNewAccessToken);
  const rememberInfo = await User.findOne(
    {
      _id: req.session.userId
    },
    ['rT']
  );
  let { rT } = rememberInfo;

  console.log('Line 111 in rt route', rT);
  client.refresh(rT);
  const aT = await client.getNewAcc();

  res.header('authorization', aT);

  // //! Fetch to refrech access token on upload to solve token problem HOPEFULLY

  if (keys.length === 2) {
    youtubeupload()
      .then((data) => {
        getIpfsHash().then((link) => {
          data.ipfs = link;
          console.log('data ', data);
          res.send(data);
        });

        console.log('index.js youtube callback: ', data);
      })
      .catch((err) => err.message);
  } else {
    youtubeupload()
      .then((data) => {
        res.send(data);
      })
      .catch((err) => err.message);
  }
});

router.get('/upload-youtube', (req, res) => {
  res.send([videoInfo]);
});

/*******Logout route */
router.post('/logout', async (req, res) => {
  res.removeHeader('Authorization');
  res.clearCookie(req.session);
  req.session.destroy((err) => {
    if (err) console.log(err);
    res.redirect('/');
  });
});
/*******Logout route end*/

//! ****************** Oauth routes made from refactoring **********************//

const scopes = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube'
];

/* After OAuth routes to /dashboard to update token into header */
router.post('/youtube-auth', (req, res) => {
  client.authenticate(scopes, req.session.userId).then((data) => {
    console.log(data.authorizeUrl);
    let token = data.credentials.access_token;
    access_token = token;
    res.header('authorization', token);
    res.status(200).json({ url: data.authorizeUrl });
  });
});

router.get('/oauth2callback', async (req, res) => {
  console.log(client);
  console.log(req.session);
  const qs = new url.URL(req.url, process.env.APP_URL).searchParams;
  const { tokens } = await client.oAuth2Client.getToken(qs.get('code'));
  console.log(qs);
  //   this.oAuth2Client.credentials = tokens;
  //   resolve(this.oAuth2Client);

  client.oAuth2Client.setCredentials(tokens);

  /** This saves the rT to the db, userId is not accessible from the server so I sent it from when you click the youtube check box**/
  /** UserId is used look up the logged in user and save the rT**/
  console.log('YOYOYOYOYO', client.oAuth2Client.userId);

  if (tokens.refresh_token) {
    User.findOneAndUpdate(
      { _id: client.oAuth2Client.userId },
      { $set: { rT: tokens.refresh_token } }
    )
      .then(() => {
        console.log('Line 93 Clientjs');
        return res.redirect('/');
      })
      .catch((err) => console.log(err));
  }
});

//! ****************** Oauth routes made from refactoring **********************//

module.exports = router;
