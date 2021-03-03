import { Athlete } from './athlete';

export interface User {
    athlete?: Athlete;
    created?: Date;
    update?: Date;
    email?: String;
    fullname?: String;
    birthdate?: Date;
    expirationDate?: Number;
    refreshToken?: String;
    token?: String;
}