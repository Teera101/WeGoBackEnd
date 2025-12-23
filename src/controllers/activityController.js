import Activity from '../models/activity.js';
import Group from '../models/group.js';

export const createActivity = async (req, res) => {
  try {
    const { title, description, location, date, time, tags, maxParticipants, cover } = req.body;
    const userId = req.user._id || req.user.id;

    const newActivity = new Activity({
      title,
      description,
      location,
      date,
      time,
      tags,
      maxParticipants,
      cover,
      createdBy: userId,
      participants: [userId]
    });
    const savedActivity = await newActivity.save();

    const newGroup = new Group({
      name: title,
      description: `Group for activity: ${title}`,
      maxMembers: maxParticipants,
      cover: cover,
      relatedActivity: savedActivity._id.toString(),
      createdBy: userId,
      members: [{ 
        userId: userId, 
        role: 'owner', 
        joinedAt: new Date() 
      }],
      bannedUsers: []
    });
    
    await newGroup.save();

    res.status(201).json(savedActivity);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const getActivities = async (req, res) => {
  try {
    const activities = await Activity.find().populate('createdBy', 'name avatar email');
    res.status(200).json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getActivityById = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id).populate('createdBy', 'name avatar email');
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    res.status(200).json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};