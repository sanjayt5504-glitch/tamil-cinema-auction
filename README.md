# Kollywood Auction Arena

A mobile-friendly real-time multiplayer Tamil cinema talent auction game, based on the supplied Socket.IO server.

## Features
- Create a private room and share its six-character room code
- 2–6 players; host starts the auction
- ₹100 Cr virtual budget per studio
- Bid live on Lead Actors, Lead Actresses, Directors and Composers
- Live studio budgets, signed talent, auction feed and final score rankings
- Reconnection support using a browser-local token

## Run locally
Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. For friends on different devices, deploy the app to a public Node hosting provider and share the deployed URL plus room code.

## Publish on Render
1. Put this folder in a GitHub repository.
2. In Render, create **New + → Web Service** and connect the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy; open the generated HTTPS URL and create a room.

## Important limits
- This is a working app project, not yet hosted at a public URL. Publishing requires access to a hosting account and deploying this folder.
- Rooms and scores live in server memory and are cleared after two hours of inactivity; a server restart clears all rooms.
- For production-scale play, use a persistent shared store such as Redis and configure multi-instance Socket.IO coordination.
- Talent ratings and opening prices are fictional game values. This is a fan-made game, not affiliated with the named artists.
