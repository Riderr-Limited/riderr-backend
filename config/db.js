import mongoose from "mongoose";

const MONGODB_URL = process.env.MONGODB_URL;


if(!MONGODB_URL){
    throw new Error("please define the mongodb url");
}

const connetToDatabase = async () => {
    try {
        await mongoose.connect(MONGODB_URL);
        console.log("Connected to database");
        
    } catch (error) {
        console.log('error connecting to database', error);
        
    }
}

export default connetToDatabase