import mongoose from "mongoose"
import User from "../models/user.models.js";
import bcrypt from "bcryptjs";
import jsonwebtoken from "jsonwebtoken";

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const  JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

export const signUp = async(req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction(); 

    try {
        const { name, email, password, phone } = req.body;
        
        //check if user already exist;
        const existingUser = await User.findOne({ email });
        if(existingUser){
            const error = new Error('user already exists');
            error.statusCode = 409;
        }
        // hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create([{ name, email, password: hashedPassword, phone }], { session });
        const token = jsonwebtoken.sign({ userId: newUser[0]._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        
        await session.commitTransaction();
        session.endSession();
        res.status(201).json({
            success: true,
            message: "user created successfully",
            data: {
                token,
                user: newUser[0]
            }
        })
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error)
    }
}
export const signIn = async(req, res, next) => {
    try{
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if(!user){
            const error = new Error("user not found!");
            error.statusCode = 404;
            throw error;
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if(!isPasswordValid){
            const error = new Error("invalid password");
            error.statusCode = 401;
            throw error;
        }

        const token = jsonwebtoken.sign({ userId: user._id}, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.status(200).json({
            success: true,
            message: "User signed in successfully",
            data: {
                token,
                user
            }
        });

    } catch (error){
        next(error)
    }
}
export const signOut = async(req,res, next) => {}