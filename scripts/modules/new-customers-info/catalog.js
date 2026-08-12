'use strict';

const DEFAULT_PROPERTIES = [
  {
    id: '14-hayden',
    available: true,
    address: '14 Hayden Crt, Brampton, ON L6S 1Y3',
    room: 'Habitación disponible',
    maxOccupants: 1,
    parkingSpaces: 1,
    prices: { 1: 850 },
    mediaItems: [{
      mediaPath: 'web/assets/new-customers/14-hayden.jpg',
      mediaUrl: '/assets/new-customers/14-hayden.jpg',
      mediaName: '14 Hayden Crt.jpg',
    }],
  },
  {
    id: '11-huntingwood',
    available: true,
    address: '11 Huntingwood Cres, Brampton, ON L6S 1S5',
    room: 'Habitación para una persona o pareja',
    maxOccupants: 2,
    parkingSpaces: 2,
    prices: { 1: 1000, 2: 1200 },
    mediaItems: [{
      mediaPath: 'web/assets/new-customers/11-huntingwood.jpg',
      mediaUrl: '/assets/new-customers/11-huntingwood.jpg',
      mediaName: '11 Huntingwood Cres.jpg',
    }],
  },
  {
    id: '152-royal-palm-1',
    available: true,
    address: '152 Royal Palm Drive, Brampton, ON',
    room: 'Habitación #1',
    maxOccupants: 1,
    parkingSpaces: 1,
    prices: { 1: 1000 },
    mediaItems: [{
      mediaPath: 'web/assets/new-customers/152-royal-palm-room-1.jpg',
      mediaUrl: '/assets/new-customers/152-royal-palm-room-1.jpg',
      mediaName: '152 Royal Palm Drive - Habitacion 1.jpg',
    }],
  },
  {
    id: '152-royal-palm-2',
    available: true,
    address: '152 Royal Palm Drive, Brampton, ON',
    room: 'Habitación #2',
    maxOccupants: 1,
    parkingSpaces: 1,
    prices: { 1: 900 },
    mediaItems: [{
      mediaPath: 'web/assets/new-customers/152-royal-palm-room-2.jpg',
      mediaUrl: '/assets/new-customers/152-royal-palm-room-2.jpg',
      mediaName: '152 Royal Palm Drive - Habitacion 2.jpg',
    }],
  },
  {
    id: '17-hilldowntree-1',
    available: true,
    address: '17 Hilldowntree Trail, Brampton, ON L6S 1P7',
    room: 'Habitación #1',
    maxOccupants: 1,
    parkingSpaces: 0,
    prices: { 1: 900 },
    mediaItems: [],
  },
  {
    id: '17-hilldowntree-2',
    available: true,
    address: '17 Hilldowntree Trail, Brampton, ON L6S 1P7',
    room: 'Habitación #2',
    maxOccupants: 1,
    parkingSpaces: 0,
    prices: { 1: 850 },
    mediaItems: [],
  },
];

function matchProperties(answers, properties = DEFAULT_PROPERTIES) {
  const occupants = Number(answers.occupants);
  const needsParking = answers.parking === true;
  return properties
    .filter((property) => property.available !== false)
    .filter((property) => property.maxOccupants >= occupants)
    .filter((property) => !needsParking || property.parkingSpaces > 0)
    .filter((property) => Number(property.prices?.[occupants]) > 0)
    .sort((left, right) => (
      right.parkingSpaces - left.parkingSpaces
      || left.prices[occupants] - right.prices[occupants]
      || left.address.localeCompare(right.address)
    ));
}

module.exports = { DEFAULT_PROPERTIES, PROPERTIES: DEFAULT_PROPERTIES, matchProperties };
