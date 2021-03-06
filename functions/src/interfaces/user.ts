import { Athlete } from './athlete';

export interface User {
    athlete?: Athlete;
    created?: Date;
    update?: Date;
    email?: String;
    name?: String;
    birthdate?: Date;
    expirationDate?: Number;
    refreshToken?: String;
    token?: String;
}